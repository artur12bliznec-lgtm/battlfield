class_name Sfx
extends RefCounted
## Звуки боя (assets/sounds/*.wav — их синтезирует scripts/make-sounds.mjs):
## разовое проигрывание в точке мира или «в ушах» игрока.

const DIR := "res://assets/sounds/"

static var _cache := {}


static func stream(sound: String) -> AudioStream:
	if not _cache.has(sound):
		_cache[sound] = load(DIR + sound + ".wav")
	return _cache[sound]


## Разовый звук в точке мира; плеер сам удалится, когда звук доиграет.
## unit_size — на каком расстоянии звук ещё в полную силу (дальше тише).
static func play_at(
	parent: Node, sound: String, at: Vector3, volume_db := 0.0, unit_size := 10.0
) -> AudioStreamPlayer3D:
	var player := AudioStreamPlayer3D.new()
	player.stream = stream(sound)
	player.volume_db = volume_db
	player.unit_size = unit_size
	player.max_db = 6.0
	player.pitch_scale = randf_range(0.94, 1.06)
	player.attenuation_filter_cutoff_hz = 7000.0  # издалека — глуше
	player.attenuation_filter_db = -18.0
	player.panning_strength = 1.2
	parent.add_child(player)
	player.global_position = at
	player.finished.connect(player.queue_free)
	player.play()
	return player


## Разовый звук без места — «в ушах» (оружие игрока, механика).
static func play(parent: Node, sound: String, volume_db := 0.0, pitch := 1.0) -> AudioStreamPlayer:
	var player := AudioStreamPlayer.new()
	player.stream = stream(sound)
	player.volume_db = volume_db
	player.pitch_scale = pitch
	parent.add_child(player)
	player.finished.connect(player.queue_free)
	player.play()
	return player
