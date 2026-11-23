// Apply the saved theme before the first paint (see src/web/theme.ts).
// A file, not an inline script, so the Content-Security-Policy in public/_headers can refuse every inline script.
(function () {
  var choice = null;
  try {
    choice = localStorage.getItem("kontrolwp.theme");
  } catch (error) {}
  var dark = choice === "dark" || (choice !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();
