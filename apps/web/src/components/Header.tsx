import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

export function Header({ children }: Props) {
  return (
    <header className="app-header">
      <img
        className="app-header__logo"
        src="/kiip-logo.svg"
        alt="Kiip"
        width={80}
        height={40}
      />
      <p className="app-header__label">{children}</p>
    </header>
  );
}
