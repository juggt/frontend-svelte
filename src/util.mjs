import { Session } from "svelte-session-manager";

// The Session constructor calls update(localStorage) which lacks `token_type`.
// update() then calls invalidate() which deletes all tokens from localStorage.
// Fix: save tokens before construction, then re-hydrate the session after,
// ensuring access_token changes from undefined→value to trigger subscriptions.
const _savedAccessToken = localStorage.getItem("access_token");
const _savedRefreshToken = localStorage.getItem("refresh_token");
const _savedUsername = localStorage.getItem("username");

export const session = new Session(localStorage);

// After construction, localStorage is empty (invalidate() deleted everything).
// Re-hydrate the session if we had a valid token.
if (_savedAccessToken && !session.isValid) {
  session.update({
    access_token: _savedAccessToken,
    refresh_token: _savedRefreshToken ?? undefined,
    username: _savedUsername ?? undefined,
    token_type: "bearer",
  });
}

export function headers(session) {
  return {
    "content-type": "application/json",
    ...session.authorizationHeader
  };
}
