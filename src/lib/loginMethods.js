// Extension boundary for future login methods. Only password is enabled.
// A future provider must retain the same Supabase session and account identity.
export function createLoginMethods(auth) {
  return Object.freeze({
    password: ({ email, password }) => auth.signInWithPassword({ email: email.trim(), password }),
  });
}
