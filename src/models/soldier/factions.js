/**
 * Две стороны конфликта. Отличаются не только цветом формы, но и силуэтом:
 * игрок должен узнавать врага издалека, как в Battlefield.
 *
 *   Альянс   — лесной камуфляж, плитник с подсумками и аптечкой, штурмовой
 *              рюкзак с рацией, шлем в чехле с противовесом и стробоскопом,
 *              активные наушники, борода и тёмные очки, синие повязки.
 *   Коалиция — пустынная «цифра», разгрузка-«лифчик», рюкзак со скаткой
 *              и лопаткой, закатанные рукава и часы, фляга, балаклава,
 *              очки-маска, клетчатый шемаг, красные повязки.
 *
 * colors превращаются в материалы с именами вида «alliance_uniform».
 */
export const FACTIONS = {
  alliance: {
    id: 'alliance',
    name: 'Альянс',
    team: 'Синие',
    colors: {
      uniform: { texture: 'woodland', roughness: 0.92 },
      uniformShade: { texture: 'woodland', color: '#b8b6aa', roughness: 0.92 },
      gear: { color: '#8a7650', roughness: 0.85 },
      gearDark: { color: '#6a5b3f', roughness: 0.85 },
      helmet: { texture: 'woodland', color: '#e9e4d6', roughness: 0.85 },
      gloves: { color: '#26272a', roughness: 0.8 },
      boots: { color: '#6b5436', roughness: 0.85 },
      laces: { color: '#4a3a26', roughness: 0.9 },
      belt: { color: '#38372f', roughness: 0.85 },
      kneePads: { color: '#3d3a31', roughness: 0.7 },
      headset: { color: '#2b2e2b', roughness: 0.6 },
      head: { color: '#c58f6b', roughness: 0.7 },
      beard: { color: '#3a2a1d', roughness: 0.95 },
      team: { color: '#2f73ea', roughness: 0.5, emissive: '#0b1d3d' },
    },
  },
  coalition: {
    id: 'coalition',
    name: 'Коалиция',
    team: 'Красные',
    colors: {
      uniform: { texture: 'desertDigital', roughness: 0.92 },
      uniformShade: { texture: 'desertDigital', color: '#c4beb0', roughness: 0.92 },
      gear: { color: '#555b3a', roughness: 0.85 },
      gearDark: { color: '#42472d', roughness: 0.85 },
      helmet: { color: '#5b6040', roughness: 0.85 },
      gloves: { color: '#3b362e', roughness: 0.8 },
      boots: { color: '#1f2021', roughness: 0.75 },
      laces: { color: '#111111', roughness: 0.9 },
      belt: { color: '#3b3d2b', roughness: 0.85 },
      kneePads: { color: '#262725', roughness: 0.7 },
      scarf: { texture: 'shemagh', roughness: 0.95 },
      goggleLens: { color: '#d08a2c', metalness: 0.3, roughness: 0.1, emissive: '#3a1f04' },
      head: { color: '#2c2d28', roughness: 0.9 },
      skin: { color: '#b98463', roughness: 0.7 },
      team: { color: '#da3f2f', roughness: 0.5, emissive: '#3d0e0a' },
    },
  },
};
