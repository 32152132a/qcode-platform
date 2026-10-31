export function gatewayAddress(value) {
  const url = new URL(value);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('网关地址必须为不含路径和凭据的 HTTP(S) 地址');
  return url.origin;
}
