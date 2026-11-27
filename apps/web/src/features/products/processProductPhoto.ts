import { PHOTO_MIME_TYPES, type DeidBox, type PhotoMime, type ProductPhoto } from '@templeyard/shared';
import { postOriginalProductPhoto, postProductPhoto } from '../../api/client';
import { boxesFromDetections } from '../deid/boxes';
import { getFaceDetector } from '../deid/faceDetector';
import { DEID_OUTPUT_MIME, blobToBase64, loadImage, renderDeidentified } from '../deid/render';
import { DETECTOR_UNAVAILABLE_MESSAGE, PhotoProcessError } from '../photos/processPhoto';

// 商品照的處理流程（沿用 F4）：在瀏覽器偵測臉孔並遮蔽 → 原圖存本機 → 去識別後的圖存本機（之後才可能送往雲端）

function isPhotoMime(type: string): type is PhotoMime {
  return (PHOTO_MIME_TYPES as readonly string[]).includes(type);
}

export async function processAndUploadProductPhoto(productId: string, file: File, viewKey: string | null): Promise<ProductPhoto> {
  if (!isPhotoMime(file.type)) throw new PhotoProcessError(`「${file.name}」不是 JPEG、PNG 或 WebP 照片，沒有上傳。`);

  const image = await loadImage(file).catch(() => {
    throw new PhotoProcessError(`「${file.name}」打不開，沒有上傳。`);
  });

  // 偵測失敗就不上傳：沒有遮蔽過的照片不能存成「已去識別」
  let boxes: DeidBox[];
  try {
    const detector = await getFaceDetector();
    boxes = boxesFromDetections(await detector.detect(image));
  } catch {
    throw new PhotoProcessError(DETECTOR_UNAVAILABLE_MESSAGE);
  }

  const deidentified = await renderDeidentified(image, boxes);
  const original = await postOriginalProductPhoto(productId, { mime: file.type, dataBase64: await blobToBase64(file) });
  return postProductPhoto(productId, {
    originalAssetId: original.id,
    deidentified: { mime: DEID_OUTPUT_MIME, dataBase64: await blobToBase64(deidentified) },
    deidBoxes: boxes,
    viewKey,
  });
}
