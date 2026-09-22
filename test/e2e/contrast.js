// Passed directly to Playwright's locator.evaluate so Chromium measures the
// rendered foreground against the nearest painted background.
export function measureContrast(element) {
  const channels = (color) =>
    color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map((channel) => Number(channel) / 255);
  const luminance = (color) =>
    channels(color)
      .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  let backgroundElement = element;
  while (backgroundElement && getComputedStyle(backgroundElement).backgroundColor.endsWith(", 0)"))
    backgroundElement = backgroundElement.parentElement;
  const foreground = luminance(getComputedStyle(element).color);
  const background = luminance(
    getComputedStyle(backgroundElement || document.body).backgroundColor,
  );
  return {
    theme: document.documentElement.dataset.theme,
    ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
  };
}
