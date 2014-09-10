var game = new Phaser.Game(1024, 768, Phaser.AUTO, 'vectorman', {
  preload: preload,
  create: create,
  update: update,
  render: render
});

var ANIMATIONSPEED = 60; // fps

// The number of frames in the landing animation
var TIMETOLAND = 16/60 * 1000;

// The number of frames in the start running animation
var TIMETORUN = 26/60 * 1000;

// World gravity
var GRAVITY = 650;

// The time between jumps
var JUMPVELOCITY = 340;
var BOOSTVELOCITY = 365;
var MAXBOOSTS = 1;

// The speed of running
var RUNSTARTSPEED = 180;
var RUNFULLSPEED = 300;

var map;
var tileset;
var foreground;
var background;
var player;
var running = false;
var mode = null;
var facing = 'right';
var runTimer = 0;
var cursors;
var jumpButton;
var bg;
var music;
var audio;

// Whether the player is currently running at full speed
var fullSpeed = false;

// The time when we can next boost
var jumpReleased = true;

// The number of boosts the player has used in flight
var boostCount = 0;

// When the player started landing
var landStart = 0;

// Whether the player is on the floor or not
var touching = { down: false, up: false};

// 1 based frame numbers of animations
var animations = {
  'idle': [1, 31, false],
  'run-start': [32, 57, false],
  'run': [58, 91, true],
  'jump': [92, 120, false],
  'boost': [121, 156, false],
  'fall': [120, 120, false],
  'land': [157, 173, false]
};

function preload() {
  game.load.tilemap('level1', 'assets/level1.json', null, Phaser.Tilemap.TILED_JSON);
  game.load.image('tiles', 'assets/tiles.png');
  game.load.spritesheet('vectorman', 'assets/vectorman.png', 100, 100);
  game.load.image('background', 'assets/background.png');
  game.load.audio('bamboo-mill', ['assets/music/Bamboo Mill.ogg']);
  game.load.audio('audio', ['assets/audio/sprite.mp3', 'assets/audio/sprite.ogg']);
  game.load.json('audio', 'assets/audio/sprite.json');
}

/**
  Create an array with numbers from start to end inclusive
*/
function spriteMap(start, end) {
  var map = [];
  for (var i = start; i <= end; i++) {
    map.push(i);
  }
  return map;
}

function create() {
  // Play music
  music = game.add.audio('bamboo-mill');
  music.play();

  // Setup audio
  audio = game.add.audio('audio');

  var audioInfo = game.cache.getJSON('audio');
  for (var soundName in audioInfo.spritemap) {
    var sound = audioInfo.spritemap[soundName];
    // console.log('Sound %s runs from %d to %d', soundName, sound.start, sound.end - sound.start);
    audio.addMarker(soundName, sound.start, sound.end - sound.start);
  }

  // Start physics simulation
  game.physics.startSystem(Phaser.Physics.P2JS);
  game.physics.p2.gravity.y = GRAVITY;

  // Same as bottom of background
  game.stage.backgroundColor = '#261e11';
  bg = game.add.tileSprite(0, 0, 3188, 900, 'background');
  bg.fixedToCamera = true;

  // Setup map
  map = game.add.tilemap('level1');
  map.addTilesetImage('tiles');

  background = map.createLayer('Background');
  background.resizeWorld();

  foreground = map.createLayer('Foreground');
  foreground.resizeWorld();

  foreground.debug = true; // Show collision box

  // Collide on everything in the foreground
  map.setCollisionBetween(0, 1000, true, foreground);

  // Convert tiles to polylines
  foregroundTiles = game.physics.p2.convertTilemap(map, foreground);

  player = game.add.sprite(128, 768, 'vectorman');
  player.anchor.setTo(0.5, 0); // So it flips around its middle
  game.physics.p2.enable(player);

  player.body.fixedRotation = true; // Never rotate
  player.body.debug = true; // Show collision box

  setNormalHitBox();

  // Setup animations
  for (var animationName in animations) {
    var animationFrames = animations[animationName];
    // console.log('Animation %s runs from %d to %d', animationName, animationFrames[0]-1, animationFrames[1]-1);
    player.animations.add(animationName, spriteMap(animationFrames[0]-1, animationFrames[1]-1), ANIMATIONSPEED, animationFrames[2]);
  }

  // Camera follows player
  game.camera.follow(player);

  // Face initial direction
  setSpriteDirection(facing);

  // Controls
  cursors = game.input.keyboard.createCursorKeys();
  jumpButton = game.input.keyboard.addKey(Phaser.Keyboard.SPACEBAR);
}

/**
  Flip the sprite to match the given direction
*/
function setSpriteDirection(direction) {
  if (direction === 'right') {
    player.scale.x = -1;
  }
  else {
    player.scale.x = 1;
  }
}

function run(direction) {
  var additionalRunVelocity = 0;

  // Set sprite direction
  setSpriteDirection(direction);

  // If they switch direction or just start running
  if (!running) {
    // Start a timer where we'll run at full speed
    runTimer = game.time.now + TIMETORUN;

    fullSpeed = false;
    running = true;
    facing = direction;
  }
  else {
    if (!fullSpeed && game.time.now > runTimer) {
      // We're now running at full speed
      fullSpeed = true;
    }
  }

  if (!fullSpeed) {
    // Accerate to full speed
    additionalRunVelocity = (1 - (runTimer - game.time.now) / TIMETORUN) * (RUNFULLSPEED - RUNSTARTSPEED);
  }

  if (touching.down) {
    // Switch the animation
    var animation = 'run' + (fullSpeed ? '' : '-start');

    player.animations.play(animation);
  }
  else if (mode != 'jump' && mode != 'boost') {
    mode = 'jump';
    player.animations.play('jump');
  }

  // Set speed
  player.body.velocity.x = (direction === 'left' ? -1 : 1) * ((fullSpeed ? RUNFULLSPEED : RUNSTARTSPEED) + additionalRunVelocity);
}

function getTouches(someone) {
  var yAxis = p2.vec2.fromValues(0, 1);
  var down = false;
  var up = false;
  for (var i = 0; i < game.physics.p2.world.narrowphase.contactEquations.length; i++) {
    var c = game.physics.p2.world.narrowphase.contactEquations[i]; // cycles through all the contactEquations until it finds our "someone"
    if (c.bodyA === someone.body.data || c.bodyB === someone.body.data) {
      var d = p2.vec2.dot(c.normalA, yAxis); // Normal dot Y-axis
      if (c.bodyA === someone.body.data) d *= -1;
      if (d > 0.5) {
        down = true;
      }
      else if (d < 0.5) {
        up = true;
      }
    }
  }

  return {
    down: down,
    up: up
  };
}

function setNormalHitBox() {
  // player.body.setRectangleFromSprite(player); // Size of sprite
  player.body.setCircle(32, 0, 16); // Circular collision body
  // player.body.setRectangle(42, 50, 0, 16); // Rectangular body
}

function update() {
  // Only apply physics to the foreground
  // game.physics.arcade.collide(player, foreground, collisionHandler);

  // Reset velocity
  player.body.velocity.x = 0;

  // Calculate if we're touching
  var touches = getTouches(player);
  touching.down = touches.down;
  touching.up = touches.up;

  if (touching.down) {
    // If we were jumping, but we landed on the floor, show the landing animation
    if (mode === 'jump') {
      mode = 'land';
      player.animations.play('land');
      audio.play('land');
      landStart = game.time.now;
    }
  }

  if (cursors.left.isDown) {
    run('left');
  }
  else if (cursors.right.isDown) {
    run('right');
  }
  else if (mode != 'land' || game.time.now > landStart + TIMETOLAND) {
    if (touching.down) {
      player.animations.play('idle');
      mode = 'idle';
    }
    else if (mode !== 'jump') {
      mode = 'jump';
      player.animations.play('fall');
    }
  }

  // If we're:
    // not on the floor
    // not pressing jump
    // not over boost count
  var canBoost = false;
  if (jumpReleased && !touching.down && boostCount < MAXBOOSTS) {
    canBoost = true;
  }

  if (jumpButton.isDown) {
    if (jumpReleased) {
      if (touching.down) {
        player.body.velocity.y = -1 * JUMPVELOCITY;
        mode = 'jump';
        player.animations.play('jump');
      }
      else if (jumpButton.isDown && canBoost) {
        player.body.velocity.y = -1 * BOOSTVELOCITY;
        boostCount++;
        player.animations.stop();
        player.animations.play('boost');
        audio.play('boost');
      }
    }

    jumpReleased = false;
  }
  else {
    jumpReleased = true;
  }

  // When we touch the ground, reset boost count
  if (touching.down) {
    boostCount = 0;
  }
}

function collisionHandler(obj1, obj2) {
}

function render() {
  // game.debug.text(game.time.physicsElapsed, 32, 32);
  // game.debug.body(player);
  // game.debug.bodyInfo(player, 16, 24);
}
