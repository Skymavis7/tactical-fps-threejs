// The look plan, in one place: dusk at an industrial harbour. Six neutrals, one accent
// hue, and the two team colours. The same names are the CSS custom properties in index.html.
// Nothing else in the code names a colour literal.
export const PALETTE = {
  canvas: '#0d141d', // night sky / fog
  surface: '#1c2733', // concrete
  hairline: '#35424f', // steel trim
  ink: '#ece7db', // warm off-white
  muted: '#93a3b1', // mist grey-blue
  accent: '#ff8a2a', // safety orange (Tidebreakers, the attackers)
  teamB: '#35c4b5', // harbour teal (Harbour Watch, the defenders)
  danger: '#e5484d', // damage red
  rust: '#b4552d', // rusted container
  teal: '#2e6f6a', // painted container
  ochre: '#7a6a3f', // faded container
  ground: '#232d38', // asphalt
  lamp: '#ffc46b', // sodium lamp glow
};

export function shade(name) {
  return PALETTE[name];
}
