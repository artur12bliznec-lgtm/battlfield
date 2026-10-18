import { createAssaultRifle } from './weapons/assaultRifle.js';
import { createRifle } from './weapons/rifle.js';
import { createSniperRifle } from './weapons/sniperRifle.js';
import { createMachineGun } from './weapons/machineGun.js';
import { createPistol } from './weapons/pistol.js';
import { createBandage } from './items/bandage.js';
import { createSoldier } from './soldier/soldier.js';
import { createSoldierController, MOTIONS, CLIPS } from './soldier/animation.js';
import { createLineup, createLineupController } from './lineup.js';
import { bipodLegRotation } from './weapons/handling.js';

/** Раскладывает/складывает сошки (узлы bipod_leg_l / bipod_leg_r). */
function setBipod(model, deployed, foldedForward) {
  for (const name of model.userData.bipod ?? []) {
    model.getObjectByName(name).rotation.copy(bipodLegRotation(name, foldedForward, deployed ? 1 : 0));
  }
}

const WEAPONS = {
  assault_rifle: createAssaultRifle,
  rifle: createRifle,
  machine_gun: createMachineGun,
  sniper_rifle: createSniperRifle,
  pistol: createPistol,
};

const soldierOptions = [
  {
    id: 'weapon',
    type: 'select',
    label: 'Оружие в руках',
    default: 'assault_rifle',
    choices: [
      ['assault_rifle', 'Автомат'],
      ['rifle', 'Винтовка'],
      ['machine_gun', 'Пулемёт'],
      ['sniper_rifle', 'Снайперская винтовка'],
      ['pistol', 'Пистолет'],
      ['none', 'Без оружия'],
    ],
    apply: (model, value, controller) => controller.setWeapon(value),
  },
  {
    id: 'motion',
    type: 'select',
    label: 'Анимация',
    default: 'idle',
    choices: [['tpose', 'T-поза (как в файле)'], ...Object.entries(MOTIONS).map(([id, m]) => [id, m.label])],
    // движение можно задать и в адресе: ?motion=reload
    apply: (model, value, controller) => controller.setMotion(value),
  },
];

const bipodOption = (foldedForward) => ({
  id: 'bipod',
  type: 'toggle',
  label: 'Сошки разложены',
  default: false,
  reframe: true,
  apply: (model, value) => setBipod(model, value, foldedForward),
});

/**
 * Каталог моделей: всё, что можно посмотреть в просмотрщике и выгрузить в .glb.
 * create() каждый раз строит новую копию модели.
 */
export const CATALOG = [
  {
    id: 'lineup',
    kind: 'scene',
    group: 'Обзор',
    name: 'Все модели',
    note: 'Обе стороны, оружие и бинт',
    view: 'hero',
    create: createLineup,
    controller: createLineupController,
  },
  {
    id: 'soldier_alliance',
    kind: 'soldier',
    group: 'Бойцы',
    name: 'Боец Альянса',
    note: 'Синие · плитник, рация, наушники',
    swatch: 'alliance',
    view: 'iso',
    create: (preview) => createSoldier('alliance', { animations: !preview }),
    options: soldierOptions,
    clips: CLIPS.length,
    controller: (model) => createSoldierController(model, WEAPONS),
  },
  {
    id: 'soldier_coalition',
    kind: 'soldier',
    group: 'Бойцы',
    name: 'Боец Коалиции',
    note: 'Красные · разгрузка, рюкзак, балаклава',
    swatch: 'coalition',
    view: 'iso',
    create: (preview) => createSoldier('coalition', { animations: !preview }),
    options: soldierOptions,
    clips: CLIPS.length,
    controller: (model) => createSoldierController(model, WEAPONS),
  },
  {
    id: 'assault_rifle',
    kind: 'weapon',
    group: 'Оружие',
    name: 'Автомат',
    note: 'АК-образный · 5,45 мм',
    view: 'side',
    create: createAssaultRifle,
  },
  {
    id: 'rifle',
    kind: 'weapon',
    group: 'Оружие',
    name: 'Винтовка',
    note: 'M4-образная · 5,56 мм',
    view: 'side',
    create: createRifle,
  },
  {
    id: 'machine_gun',
    kind: 'weapon',
    group: 'Оружие',
    name: 'Пулемёт',
    note: 'ПКМ-образный, лента на 100 · 7,62 мм',
    view: 'side',
    create: createMachineGun,
    options: [bipodOption(false)],
  },
  {
    id: 'sniper_rifle',
    kind: 'weapon',
    group: 'Оружие',
    name: 'Снайперская винтовка',
    note: 'Для разведчика, с оптикой · 8,6 мм',
    view: 'side',
    create: createSniperRifle,
    options: [bipodOption(true)],
  },
  {
    id: 'pistol',
    kind: 'weapon',
    group: 'Оружие',
    name: 'Пистолет',
    note: 'Полимерная рамка · 9 мм',
    view: 'side',
    create: createPistol,
  },
  {
    id: 'bandage',
    kind: 'item',
    group: 'Снаряжение',
    name: 'Бинт',
    note: 'Рулон марли, восстанавливает здоровье',
    view: 'iso',
    create: createBandage,
  },
];
