// NEON BAY — render.js
// Renderer, camera and lighting setup, plus the chase camera that follows
// the player on foot and in the car. Kept separate from the world so the
// frame loop in main.js stays short and readable.

(function () {
  'use strict';

  var THREE = window.THREE;
  var CFG = window.NB.CFG;

  function createRenderer(container) {
    var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    var pr = Math.min(window.devicePixelRatio || 1, CFG.PERF.pixelRatioCap);
    renderer.setPixelRatio(pr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    return renderer;
  }

  function createCamera() {
    var cam = new THREE.PerspectiveCamera(CFG.CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 2200);
    cam.position.set(0, 8, -14);
    return cam;
  }

  function createLights(scene, world) {
    // Low golden sun from the west, warm ambient bounce, cool sky fill.
    var sun = new THREE.DirectionalLight(0xffb066, 2.8);
    sun.position.copy(world.sunDir).multiplyScalar(300);
    sun.castShadow = true;
    sun.shadow.mapSize.set(CFG.PERF.shadowMap, CFG.PERF.shadowMap);
    sun.shadow.camera.left = -160;
    sun.shadow.camera.right = 160;
    sun.shadow.camera.top = 160;
    sun.shadow.camera.bottom = -160;
    sun.shadow.camera.far = 700;
    sun.shadow.bias = -0.0006;
    scene.add(sun);
    var hemi = new THREE.HemisphereLight(0x8a6aa8, 0x4a3a2a, 1.15);
    scene.add(hemi);
    var amb = new THREE.AmbientLight(0xff9a6a, 0.5);
    scene.add(amb);
    return { sun: sun, hemi: hemi, amb: amb };
  }

  // Follow camera: behind the player/car, eased, with a mouse orbit offset.
  // `target` is {x, z, angle, speed} and `orbit` is {yaw, pitch} in radians.
  function updateCamera(camera, target, orbit, dt, inCar) {
    var dist = inCar ? CFG.CAMERA.distance + 2 : CFG.CAMERA.distance - 2;
    var height = inCar ? CFG.CAMERA.height + 0.6 : CFG.CAMERA.height;
    var baseAngle = target.angle + Math.PI; // behind
    var yaw = baseAngle + orbit.yaw;
    var pitch = orbit.pitch;
    var tx = target.x + Math.sin(yaw) * dist * Math.cos(pitch);
    var tz = target.z + Math.cos(yaw) * dist * Math.cos(pitch);
    var ty = height + Math.sin(pitch) * dist * 0.6;
    // Never let the camera sink under the street.
    if (ty < 2.2) ty = 2.2;
    var k = 1 - Math.exp(-CFG.CAMERA.lerp * dt);
    camera.position.x += (tx - camera.position.x) * k;
    camera.position.y += (ty - camera.position.y) * k;
    camera.position.z += (tz - camera.position.z) * k;
    camera.lookAt(target.x, CFG.CAMERA.lookHeight, target.z);
    // Speed feel: widen the field of view a little at full throttle.
    var targetFov = CFG.CAMERA.fov + Math.min(10, Math.abs(target.speed || 0) * 0.22);
    camera.fov += (targetFov - camera.fov) * k;
    camera.updateProjectionMatrix();
  }

  function resize(renderer, camera) {
    var w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  window.NB = window.NB || {};
  window.NB.Render = {
    createRenderer: createRenderer,
    createCamera: createCamera,
    createLights: createLights,
    updateCamera: updateCamera,
    resize: resize,
  };
})();
