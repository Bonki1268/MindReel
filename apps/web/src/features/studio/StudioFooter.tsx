import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** 創作工作區底部整列的位置：面板把自己的底部操作列放進來，操作列才會橫跨整個畫面 */
export const StudioFooterContext = createContext<HTMLElement | null>(null);

/** 把底部操作列放到工作區最底下；不在創作工作區裡時（例如單元測試）就放在原地 */
export function StudioFooter({ children }: { children: ReactNode }) {
  const slot = useContext(StudioFooterContext);
  return slot ? createPortal(children, slot) : <>{children}</>;
}
