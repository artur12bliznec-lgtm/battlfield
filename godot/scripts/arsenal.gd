class_name Arsenal
extends RefCounted
## Инвентарь бойца: всё оружие и бинт, характеристики и поведение в бою.
## Порядок — ячейки 1–6.

const MODELS := "res://assets/models/"

const ITEMS := [
	{
		"id": "assault_rifle",
		"name": "Автомат",
		"about": "АК-образный. Надёжный и мощный, очередь заметно уводит вверх.",
		"kind": "long",
		"caliber": "5,45×39 мм",
		"capacity": 30,
		"magazines": 4,
		"rpm": 650,
		"modes": "авто",
		"auto": true,
		"recoil": 0.9,
		"spread": 1.3,
		"aim_fov": 50.0,
	},
	{
		"id": "rifle",
		"name": "Винтовка",
		"about": "M4-образная. Высокий темп, мягкая отдача, точная на средней дистанции.",
		"kind": "long",
		"caliber": "5,56×45 мм",
		"capacity": 30,
		"magazines": 4,
		"rpm": 800,
		"modes": "авто",
		"auto": true,
		"recoil": 0.6,
		"spread": 1.0,
		"aim_fov": 48.0,
	},
	{
		"id": "machine_gun",
		"name": "Пулемёт",
		"about": "ПКМ-образный, лента на 100 патронов. Лёжа раскладывает сошки и почти не прыгает.",
		"kind": "long",
		"caliber": "7,62×54 мм R",
		"capacity": 100,
		"magazines": 2,
		"rpm": 700,
		"modes": "авто",
		"auto": true,
		"recoil": 1.1,
		"spread": 2.2,
		"aim_fov": 52.0,
		"bipod": true,
	},
	{
		"id": "sniper_rifle",
		"name": "Снайперская винтовка",
		"about": "Для разведчика: оптика с увеличением, сошки, одиночные выстрелы.",
		"kind": "long",
		"caliber": "8,6×70 мм",
		"capacity": 5,
		"magazines": 5,
		"rpm": 40,
		"modes": "одиночный",
		"auto": false,
		"recoil": 3.5,
		"spread": 0.15,
		"aim_fov": 14.0,
		"scope": true,
		"bipod": true,
	},
	{
		"id": "pistol",
		"name": "Пистолет",
		"about": "Полимерная рамка, 17 патронов. Запасное оружие на ближнюю дистанцию.",
		"kind": "pistol",
		"caliber": "9×19 мм",
		"capacity": 17,
		"magazines": 3,
		"rpm": 400,
		"modes": "одиночный",
		"auto": false,
		"recoil": 1.6,
		"spread": 1.4,
		"aim_fov": 58.0,
	},
	{
		"id": "bandage",
		"name": "Бинт",
		"about": "Перевязка раны: боец достаёт бинт и обматывает руку. Клавиша 6 или H.",
		"kind": "item",
		"count": 5,
	},
]


static func scene(item: Dictionary) -> PackedScene:
	return load(MODELS + str(item.id) + ".glb")


## Строки характеристик для карточки в инвентаре.
static func stats(item: Dictionary) -> Array:
	if item.kind == "item":
		return [["Осталось", "%d шт." % item.count]]
	return [
		["Калибр", item.caliber],
		["Магазин", "%d патр." % item.capacity],
		["Темп", "%d выстр/мин" % item.rpm],
		["Режим", item.modes],
	]
