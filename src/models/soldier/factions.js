/**
 * Две стороны конфликта. Отличаются не только цветом формы, но и силуэтом:
 * игрок должен узнавать врага издалека, как в Battlefield.
 *
 *   Альянс   — зелёная форма, плитник с подсумками, рация с антенной,
 *              шлем с высоким вырезом и активные наушники, синие повязки.
 *   Коалиция — песочная форма, разгрузка-«лифчик», рюкзак со скаткой,
 *              шлем с чехлом, балаклава, очки-маска и шарф, красные повязки.
 *
 * colors превращаются в материалы с именами вида «alliance_uniform».
 */
export const FACTIONS = {
  alliance: {
    id: 'alliance',
    name: 'Альянс',
    team: 'Синие',
    gear: { helmet: 'highcut', face: 'glasses', vest: 'plateCarrier', pack: 'assault' },
    colors: {
      uniform: { color: '#5d6848', roughness: 0.9 },
      uniformShade: { color: '#4b5539', roughness: 0.9 },
      gear: { color: '#8a7650', roughness: 0.85 },
      gearDark: { color: '#6a5b3f', roughness: 0.85 },
      helmet: { color: '#86775a', roughness: 0.7 },
      gloves: { color: '#26272a', roughness: 0.8 },
      boots: { color: '#6b5436', roughness: 0.85 },
      belt: { color: '#38372f', roughness: 0.85 },
      kneePads: { color: '#3d3a31', roughness: 0.7 },
      headset: { color: '#2b2e2b', roughness: 0.6 },
      head: { color: '#c58f6b', roughness: 0.7 },
      team: { color: '#2f73ea', roughness: 0.5, emissive: '#0b1d3d' },
    },
  },
  coalition: {
    id: 'coalition',
    name: 'Коалиция',
    team: 'Красные',
    gear: { helmet: 'fullcut', face: 'goggles', vest: 'chestRig', pack: 'rucksack' },
    colors: {
      uniform: { color: '#a58f65', roughness: 0.9 },
      uniformShade: { color: '#8c7752', roughness: 0.9 },
      gear: { color: '#555b3a', roughness: 0.85 },
      gearDark: { color: '#42472d', roughness: 0.85 },
      helmet: { color: '#5b6040', roughness: 0.85 },
      gloves: { color: '#3b362e', roughness: 0.8 },
      boots: { color: '#1f2021', roughness: 0.75 },
      belt: { color: '#3b3d2b', roughness: 0.85 },
      kneePads: { color: '#262725', roughness: 0.7 },
      scarf: { color: '#bdb8a6', roughness: 0.95 },
      goggleLens: { color: '#d08a2c', metalness: 0.3, roughness: 0.1, emissive: '#3a1f04' },
      head: { color: '#2c2d28', roughness: 0.9 },
      team: { color: '#da3f2f', roughness: 0.5, emissive: '#3d0e0a' },
    },
  },
};
