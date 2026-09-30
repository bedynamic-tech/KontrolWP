import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setTheme, useResolvedTheme } from "../theme";

/** Switches between light and dark. Until first used, Presser follows the device. */
export function ThemeToggle() {
  const theme = useResolvedTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 text-muted-foreground hover:text-foreground"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
