export function isStorageProxyUserAuthenticated(authenticatedUserId: string | undefined, localUserOpenId: string | undefined) {
  return Boolean(authenticatedUserId && localUserOpenId && authenticatedUserId === localUserOpenId);
}
