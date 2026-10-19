extends Node
## Общее состояние игры между сценами (автозагрузка «Game»):
## выбранная команда и как открыть карту — играть или осматривать.

const TEAMS := {
	"alliance":
	{
		"name": "Альянс",
		"join": "Альянс",
		"color": Color(0.27, 0.52, 0.95),
		"model": "res://assets/models/soldier_alliance.glb",
		"weapon": "rifle",
		"about": "Синие. Лесной камуфляж, плитник с подсумками, рация, шлем с креплением ПНВ.",
	},
	"coalition":
	{
		"name": "Коалиция",
		"join": "Коалицию",
		"color": Color(0.88, 0.32, 0.25),
		"model": "res://assets/models/soldier_coalition.glb",
		"weapon": "assault_rifle",
		"about": "Красные. Пустынная «цифра», разгрузка с магазинами, балаклава, шемаг.",
	},
}

const MENU := "res://scenes/menu.tscn"
const TEAM_SELECT := "res://scenes/team_select.tscn"
const CITY := "res://scenes/city.tscn"

## Команда игрока: "alliance" или "coalition".
var team := "alliance"
## true — на карте появляется боец игрока, false — наблюдатель.
var playing := false


func play(team_id: String) -> void:
	team = team_id
	playing = true
	_go(CITY)


func spectate() -> void:
	playing = false
	_go(CITY)


func choose_team() -> void:
	_go(TEAM_SELECT)


func menu() -> void:
	_go(MENU)


func _go(path: String) -> void:
	get_tree().paused = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	get_tree().change_scene_to_file(path)
