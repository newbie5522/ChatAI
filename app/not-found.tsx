/**
 * 中文 404 页（#14）。
 * 原项目完全没有 404 页，访问到失效地址时只能看到 Next.js 的英文默认页面。
 * 这里复用统一的错误页组件，保证"任何一次异常，用户都能看懂并知道下一步做什么"。
 */

import { ErrorPage } from "./components/error-page";

export default function NotFound() {
  return <ErrorPage kind="not-found" />;
}
