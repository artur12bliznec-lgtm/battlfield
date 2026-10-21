class_name Sfx
extends RefCounted
## Звуки боя (assets/sounds/*.wav — их синтезирует scripts/make-sounds.mjs):
## разовое проигрывание в точке мира или «в ушах» игрока, «пушка» бойца.
##
## 3D-звуки здесь никогда не доигрывают до конца сами. В Godot 4.3 звуковой
## поток удаляет доигравший звук, а главный поток в то же время может ещё
## обновлять его громкость по каналам (каждый кадр, пока звук в 3D), — и
## пишет в освобождённую память: игра изредка падает. Поэтому разовый звук
## останавливается чуть раньше конца, а частые выстрелы идут через один
## бесконечный полифонический поток (gun).

const DIR := "res://assets/sounds/"

static var _cache := {}


static func stream(sound: String) -> AudioStream:
	if not _cache.has(sound):
		_cache[sound] = load(DIR + sound + ".wav")
	return _cache[sound]


## Разовый звук в точке мира; плеер удалится сам, чуть раньше конца звука.
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
	player.play()
	# запас на кадр и на то, что звуковой поток микширует с опережением
	var left := player.stream.get_length() / player.pitch_scale - 0.12
	player.get_tree().create_timer(maxf(left, 0.05), false).timeout.connect(player.queue_free)
	return player


## «Пушка» бойца: 3D-плеер для частых выстрелов. Звуки подмешиваются в один
## бесконечный поток (см. начало файла), voices — сколько звучат разом.
static func gun(parent: Node, voices := 6) -> AudioStreamPlayer3D:
	var polyphonic := AudioStreamPolyphonic.new()
	polyphonic.polyphony = voices
	var player := AudioStreamPlayer3D.new()
	player.stream = polyphonic
	player.unit_size = 12.0
	player.attenuation_filter_cutoff_hz = 7000.0
	player.attenuation_filter_db = -18.0
	player.position.y = 1.4
	parent.add_child(player)
	player.play()
	return player


## Выстрел из «пушки» gun. Голос освобождается только к следующему шагу
## микшера, поэтому, когда свободен последний, самый старый звук глушится
## заранее — к следующему выстрелу место будет (очередь звучит целиком).
static func shoot(gun_player: AudioStreamPlayer3D, sound: String, pitch := 1.0) -> void:
	var playback := gun_player.get_stream_playback() as AudioStreamPlaybackPolyphonic
	if not playback:
		return
	var voices: Array = gun_player.get_meta(&"voices", [])
	voices = voices.filter(func(id: int) -> bool: return playback.is_stream_playing(id))
	if voices.size() >= (gun_player.stream as AudioStreamPolyphonic).polyphony - 1:
		playback.stop_stream(voices.pop_front())
	var id := playback.play_stream(stream(sound), 0.0, 0.0, pitch)
	if id != AudioStreamPlaybackPolyphonic.INVALID_ID:
		voices.append(id)
	gun_player.set_meta(&"voices", voices)


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
