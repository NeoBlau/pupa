// Электропоезда. Характеристики — по открытым источникам; значения, помеченные approx, приблизительные
// (точные паспортные данные для конкретных составов МЦД в открытом доступе не подтверждены).
export const TRAINS = {
  es2g: {
    id: 'es2g',
    name: 'ЭС2Г «Ласточка»',
    short: 'ЭС2Г',
    maker: 'Уральские локомотивы / Siemens (Desiro RUS)',
    lines: ['D1', 'D2', 'D3', 'D4'],
    consists: [5, 10], // одиночный и сдвоенный составы
    defaultCars: 10,
    carLength: 26.0, // м, approx (длина 5-вагонного состава ≈130 м)
    carWidth: 3.48,
    carHeight: 4.4,
    floorHeight: 1.33, // approx
    tareMassPerCar: 51.8, // т (5 вагонов ≈ 259 т)
    loadMassPerCar: 8, // т средняя загрузка пассажирами, approx
    powerPerCar: 510, // кВт (≈2550 кВт на 5 вагонов)
    maxForcePerCar: 46, // кН, approx — даёт ускорение ≈0.9 м/с²
    maxSpeed: 160,
    serviceDecel: 1.1, // м/с², полное служебное
    emergencyDecel: 1.4,
    electricBrake: true, // рекуперация
    brakeTimeConst: 0.6, // с — быстрый электропневматический тормоз
    controller: 'combined', // единая рукоятка тяга/торможение
    doorsPerSide: 2,
    doorWidth: 1.3,
    livery: { body: 0xf2f2f0, stripe: 0xd2232a, lower: 0x3a3d42, roof: 0x8a8f96, front: 0xd2232a },
    sound: { motor: 'igbt', motorBase: 180, motorSpan: 1300, compressor: 'screw', doorChime: 'desiro' },
    models: { exterior: 'es2g_exterior', cab: 'es2g_cab' },
    description: 'Основной поезд МЦД-1 и МЦД-3 в первые годы работы диаметров. Асинхронный тяговый привод, рекуперативное торможение, единая рукоятка контроллера.',
  },
  eg2tv: {
    id: 'eg2tv',
    name: 'ЭГ2Тв «Иволга»',
    short: 'ЭГ2Тв',
    maker: 'Тверской вагоностроительный завод',
    lines: ['D1', 'D2', 'D3', 'D4'],
    consists: [7, 11],
    defaultCars: 11,
    carLength: 24.0, // approx
    carWidth: 3.48,
    carHeight: 4.35,
    floorHeight: 1.30,
    tareMassPerCar: 50,
    loadMassPerCar: 8,
    powerPerCar: 460, // approx
    maxForcePerCar: 48, // approx — ускорение до ≈1.0 м/с²
    maxSpeed: 160,
    serviceDecel: 1.2,
    emergencyDecel: 1.45,
    electricBrake: true,
    brakeTimeConst: 0.5,
    controller: 'combined',
    doorsPerSide: 2,
    doorWidth: 1.4,
    livery: { body: 0xe9eaec, stripe: 0xd2232a, lower: 0x50555c, roof: 0x9aa0a6, front: 0x2b2e33 },
    sound: { motor: 'igbt2', motorBase: 220, motorSpan: 1500, compressor: 'screw', doorChime: 'ivolga' },
    models: { exterior: 'eg2tv_exterior', cab: 'es2g_cab' },
    description: 'Отечественный электропоезд для МЦД-2 и МЦД-4. Быстрее разгоняется, широкие двери, асинхронный привод.',
  },
  ed4m: {
    id: 'ed4m',
    name: 'ЭД4М',
    short: 'ЭД4М',
    maker: 'Демиховский машиностроительный завод',
    lines: ['D1', 'D2', 'D3', 'D4'],
    consists: [10, 11],
    defaultCars: 10,
    carLength: 21.5,
    carWidth: 3.48,
    carHeight: 4.25,
    floorHeight: 1.40,
    tareMassPerCar: 54, // approx (моторные тяжелее прицепных)
    loadMassPerCar: 9,
    powerPerCar: 400, // 5 моторных × 4×200 кВт ≈ 4000 кВт на 10 вагонов, approx
    maxForcePerCar: 36, // approx — ускорение ≈0.65 м/с²
    maxSpeed: 120,
    serviceDecel: 0.9,
    emergencyDecel: 1.2,
    electricBrake: false, // только пневматический тормоз (кран №395)
    brakeTimeConst: 2.5, // медленное наполнение тормозных цилиндров
    controller: 'separate', // КМ + кран машиниста
    doorsPerSide: 2,
    doorWidth: 1.05,
    livery: { body: 0xd8d4c4, stripe: 0x2a6b3f, lower: 0x2f4f3a, roof: 0x7f8580, front: 0xc23b2e },
    sound: { motor: 'dc', motorBase: 70, motorSpan: 380, compressor: 'piston', doorChime: 'none' },
    models: { exterior: 'ed4m_exterior', cab: null },
    description: 'Классическая электричка с коллекторными двигателями: отдельный контроллер машиниста и кран №395, тормоза срабатывают с задержкой. Работала на МЦД в первые годы (approx).',
  },
};

// Позиции контроллера машиниста ЭД4М (КМ): 0, М (маневровая), 1, 2, 3, 4 — доля силы тяги и ограничения скорости
export const ED4M_KM = [
  { name: '0', force: 0 },
  { name: 'М', force: 0.25, vmax: 15 },
  { name: '1', force: 0.55 },
  { name: '2', force: 0.75 },
  { name: '3', force: 0.9 },
  { name: '4', force: 1.0 },
];

// Положения крана машиниста №395
export const KRAN395 = [
  { name: 'I', desc: 'Отпуск и зарядка' },
  { name: 'II', desc: 'Поездное' },
  { name: 'III', desc: 'Перекрыша без питания' },
  { name: 'IV', desc: 'Перекрыша с питанием' },
  { name: 'V', desc: 'Служебное торможение' },
  { name: 'Va', desc: 'Торможение (медленная разрядка)' },
  { name: 'VI', desc: 'Экстренное торможение' },
];

export function consistLength(train, cars) { return train.carLength * cars; }
