// The logo of 好奇星球, in two forms, both generated and trimmed of their
// transparent margin:
// - the full logo (art/logo.png, from art/logo-g1.png): a stylized Earth with
//   blue oceans, green land and clouds, a light-blue orbit with a small yellow
//   moon, and the name 好奇星球 rising along the orbit. Its name is legible only
//   when the logo is shown large, so it is used where there is room.
// - the mark (art/logo-mark-trimmed.png, from art/logo-mark.png): the same
//   Earth and orbit without the name, for the navigation and app icons.
// When a page opens, either form turns and grows into place.

/** The full logo at the given height in CSS pixels; it is read out as the product name. */
export const logoImage = (height = 72) =>
  `<img src="../art/logo.png" alt="好奇星球" style="height:${height}px" class="w-auto shrink-0 animate-planet select-none" />`;

/** The mark alone at the given height; it is read out as the product name too. */
export const logoMark = (height = 40) =>
  `<img src="../art/logo-mark-trimmed.png" alt="好奇星球" style="height:${height}px" class="w-auto shrink-0 animate-planet select-none" />`;
