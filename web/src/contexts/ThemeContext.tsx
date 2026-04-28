import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'dark' | 'light';
type Ctx = { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void };

const ThemeContext = createContext<Ctx | undefined>(undefined);

function readInitial(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const saved = localStorage.getItem('la-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  // PRD: dark default — only honor system preference if explicit
  return 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitial);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('la-theme', theme);
    // Update theme-color meta to match (status bar on iOS PWA)
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0A0A0A' : '#F4F4F4');
  }, [theme]);

  const toggle = useCallback(() => setThemeState(t => (t === 'dark' ? 'light' : 'dark')), []);
  const setTheme = useCallback((t: Theme) => setThemeState(t), []);

  return <ThemeContext.Provider value={{ theme, toggle, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const c = useContext(ThemeContext);
  if (!c) throw new Error('useTheme must be used within ThemeProvider');
  return c;
}
