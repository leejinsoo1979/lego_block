// ----------------------------------------------------------------------
//  Authentication — Google OAuth via Supabase.
//
//  Thin wrapper so the rest of the app doesn't need to know about
//  Supabase's auth API directly. Handles session persistence (Supabase
//  client already writes to localStorage), profile fetching, and
//  subscribe-style auth state change notifications.
// ----------------------------------------------------------------------

import { supabase, type Profile, type Session, type User } from './supabase';

/** Listeners registered via onAuthChange — called whenever the session
 *  flips between null and a signed-in user. */
type AuthListener = (state: AuthState) => void;

export interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
}

let currentState: AuthState = {
  session: null,
  user: null,
  profile: null,
};
const listeners = new Set<AuthListener>();

/** Fetch the `profiles` row for the given user. Returns null if the
 *  row hasn't been created yet — the DB trigger usually creates it on
 *  signup, but there's a short window right after OAuth callback when
 *  it may still be propagating. */
async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) {
    // PGRST116 = no rows. Anything else is a real error we want to see.
    if (error.code !== 'PGRST116') {
      console.warn('[auth] fetchProfile error:', error);
    }
    return null;
  }
  return data as Profile;
}

/** Called internally whenever the Supabase session changes. Updates our
 *  cached state and notifies all listeners. */
async function refreshState(session: Session | null) {
  const user = session?.user ?? null;
  const profile = user ? await fetchProfile(user.id) : null;
  currentState = { session, user, profile };
  for (const l of listeners) l(currentState);
}

// Bootstrap: grab the current session immediately, then subscribe to
// auth changes for the rest of the app lifetime.
(async () => {
  const { data } = await supabase.auth.getSession();
  await refreshState(data.session ?? null);
})();

supabase.auth.onAuthStateChange(async (_event, session) => {
  await refreshState(session);
});

/** Subscribe to auth state changes. Listener fires immediately with the
 *  current state and again on every future change. Returns an unsubscribe
 *  function. */
export function onAuthChange(fn: AuthListener): () => void {
  listeners.add(fn);
  fn(currentState);
  return () => listeners.delete(fn);
}

export function getAuthState(): AuthState {
  return currentState;
}

/** Kick off the Google OAuth flow. Redirects the browser to Google's
 *  consent screen; the user comes back to this page with a session. */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // Return to the current origin (works for localhost:5173 AND
      // localhost:5177). Supabase's allowlist is configured for both.
      redirectTo: window.location.origin,
    },
  });
  if (error) {
    console.error('[auth] Google sign-in failed:', error);
    alert('구글 로그인에 실패했습니다: ' + error.message);
  }
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('[auth] sign out failed:', error);
  }
}
