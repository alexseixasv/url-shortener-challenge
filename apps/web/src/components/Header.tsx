import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

export function Header({ children }: Props) {
  return (
    <header className="app-header">
      <img
        className="app-header__logo"
        src="/logo.svg"
        alt="URL Shortener"
        width={80}
        height={40}
      />
      <p className="app-header__label">{children}</p>
    </header>
  );
}
