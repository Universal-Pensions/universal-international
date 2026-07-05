import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const SignInContext = createContext();

export function SignInProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  // Optional role to preset the modal to, skipping the role-select step (e.g. a
  // landing-page "Log in as branch/agent" CTA passes open('branch')). A
  // non-string arg (such as an event object from `onClick={open}`) is coerced
  // to null so the modal falls back to the normal role picker.
  const [initialRole, setInitialRole] = useState(null);

  const open = useCallback((role) => {
    setInitialRole(typeof role === 'string' ? role : null);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo(
    () => ({ isOpen, initialRole, open, close }),
    [isOpen, initialRole, open, close],
  );

  return (
    <SignInContext value={value}>
      {children}
    </SignInContext>
  );
}

export function useSignIn() {
  return useContext(SignInContext);
}
