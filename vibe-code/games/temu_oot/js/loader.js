import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";

const parseRegionData = async (path) => {
  const response = await fetch(path, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  const data = await response.json();
  const metadata = {
    id: data.id,
    name: data.name,
    ground: data.ground,
    sky: data.sky,
    width: Number(data.width),
    depth: Number(data.depth),
    roughness: data.roughness,
  };
  const objects = Array.isArray(data.objects) ? data.objects : [];
  return { metadata, objects };
};

const buildTree = (color = 0x2f7d32) => {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.25, 1.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x7b5a3c })
  );
  const leaves = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, 1.6, 8),
    new THREE.MeshStandardMaterial({ color })
  );
  leaves.position.y = 1.2;
  group.add(trunk, leaves);
  return group;
};

const buildHouse = (color = 0xc38b4a) => {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 1.6, 2.2),
    new THREE.MeshStandardMaterial({ color })
  );
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(1.8, 1.2, 4),
    new THREE.MeshStandardMaterial({ color: 0xa94b3a })
  );
  roof.position.y = 1.4;
  roof.rotation.y = Math.PI * 0.25;
  base.position.y = 0.8;
  group.add(base, roof);
  return group;
};

const buildRock = (color = 0x6e6b6a) => {
  const mesh = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.9, 0),
    new THREE.MeshStandardMaterial({ color })
  );
  return mesh;
};

const buildTotem = (color = 0x2b5f7a) => {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.4, 2.4, 8),
    new THREE.MeshStandardMaterial({ color })
  );
  return mesh;
};

const buildFence = (length = 8, axis = "x", color = 0x8c6c3f) => {
  const group = new THREE.Group();
  const postGeo = new THREE.BoxGeometry(0.2, 1.2, 0.2);
  const railGeo = new THREE.BoxGeometry(length, 0.15, 0.2);
  const material = new THREE.MeshStandardMaterial({ color });
  const posts = Math.max(2, Math.floor(length / 1.2));
  const spacing = length / (posts - 1);

  for (let i = 0; i < posts; i += 1) {
    const post = new THREE.Mesh(postGeo, material);
    const offset = -length / 2 + i * spacing;
    if (axis === "x") {
      post.position.set(offset, 0.6, 0);
    } else {
      post.position.set(0, 0.6, offset);
    }
    group.add(post);
  }

  const railTop = new THREE.Mesh(railGeo, material);
  const railMid = new THREE.Mesh(railGeo, material);
  railTop.position.y = 0.95;
  railMid.position.y = 0.55;
  if (axis === "z") {
    railTop.rotation.y = Math.PI / 2;
    railMid.rotation.y = Math.PI / 2;
  }
  group.add(railTop, railMid);
  return group;
};

const buildArch = (color = 0xc8a46a) => {
  const group = new THREE.Group();
  const pillarGeo = new THREE.BoxGeometry(0.6, 3, 0.6);
  const beamGeo = new THREE.BoxGeometry(3, 0.6, 0.6);
  const material = new THREE.MeshStandardMaterial({ color });
  const left = new THREE.Mesh(pillarGeo, material);
  const right = new THREE.Mesh(pillarGeo, material);
  const beam = new THREE.Mesh(beamGeo, material);
  left.position.set(-1.2, 1.5, 0);
  right.position.set(1.2, 1.5, 0);
  beam.position.set(0, 3.1, 0);
  group.add(left, right, beam);
  return group;
};

const buildBanner = (color = 0xb54b5f) => {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 2.8, 6),
    new THREE.MeshStandardMaterial({ color: 0x6f5137 })
  );
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 1),
    new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide })
  );
  pole.position.y = 1.4;
  flag.position.set(0.8, 1.6, 0);
  flag.rotation.y = Math.PI / 2;
  group.add(pole, flag);
  return group;
};

const buildBridge = (length = 6, width = 2.6, color = 0x9c7a4b) => {
  const group = new THREE.Group();
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(length, 0.3, width),
    new THREE.MeshStandardMaterial({ color })
  );
  deck.position.y = 0.2;
  const railGeo = new THREE.BoxGeometry(length, 0.2, 0.2);
  const railLeft = new THREE.Mesh(railGeo, new THREE.MeshStandardMaterial({ color: 0x6b4e2e }));
  const railRight = railLeft.clone();
  railLeft.position.set(0, 0.6, width / 2 - 0.1);
  railRight.position.set(0, 0.6, -width / 2 + 0.1);
  group.add(deck, railLeft, railRight);
  return group;
};

const buildHill = (radius = 6, height = 2.6, color = 0x6cb369) => {
  const geometry = new THREE.CylinderGeometry(radius, radius * 0.8, height, 12, 1, false);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color }));
  mesh.position.y = height / 2;
  return mesh;
};

const buildStump = (radius = 0.45, height = 0.5, color = 0x7b5a3c) => {
  const geometry = new THREE.CylinderGeometry(radius * 0.9, radius, height, 8);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color }));
  mesh.position.y = height / 2;
  return mesh;
};

const buildLantern = (color = 0xf7d37a) => {
  const group = new THREE.Group();
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 1.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x6f5137 })
  );
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 10, 8),
    new THREE.MeshStandardMaterial({ color, emissive: 0xffe3a3, emissiveIntensity: 0.9 })
  );
  post.position.y = 0.6;
  glow.position.y = 1.3;
  group.add(post, glow);
  return group;
};

const deformGround = (geometry, roughness = 0.6, seed = 1) => {
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getY(i);
    const wave = Math.sin((x + seed) * 0.06) * Math.cos((z - seed) * 0.05);
    const ripple = Math.sin((x - z + seed) * 0.025);
    const height = (wave + ripple) * roughness;
    position.setZ(i, height);
  }
  geometry.computeVertexNormals();
};

class RegionLoader {
  constructor(scene, worldGroup) {
    this.scene = scene;
    this.worldGroup = worldGroup;
    this.loaded = new Map();
    this.loading = new Set();
  }

  async load(region) {
    if (this.loaded.has(region.id) || this.loading.has(region.id)) {
      return this.loaded.get(region.id);
    }
    this.loading.add(region.id);

    const { metadata, objects } = await parseRegionData(region.path);
    const group = new THREE.Group();
    group.name = metadata.name;
    group.userData.index = region.index;
    group.position.x = region.startX;

    const roughness = Number(
      metadata.roughness ?? (metadata.id.includes("mountain") ? 2.2 : metadata.id.includes("desert") ? 0.3 : 0.8)
    );
    const groundGeometry = new THREE.PlaneGeometry(
      metadata.width,
      metadata.depth,
      Math.floor(metadata.width / 8),
      Math.floor(metadata.depth / 8)
    );
    deformGround(groundGeometry, roughness, region.startX * 0.03);
    const ground = new THREE.Mesh(
      groundGeometry,
      new THREE.MeshStandardMaterial({ color: metadata.ground })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = false;
    group.add(ground);

    objects.forEach((item) => {
      let mesh = null;
      switch (item.type) {
        case "tree":
          mesh = buildTree(item.color ? Number(item.color) : undefined);
          break;
        case "house":
          mesh = buildHouse(item.color ? Number(item.color) : undefined);
          break;
        case "totem":
          mesh = buildTotem(item.color ? Number(item.color) : undefined);
          break;
        case "rock":
          mesh = buildRock(item.color ? Number(item.color) : undefined);
          break;
        case "pillar":
          mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.5, 0.6, 3, 10),
            new THREE.MeshStandardMaterial({ color: 0x9d8e7a })
          );
          break;
        case "water":
          mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(item.width, item.depth),
            new THREE.MeshStandardMaterial({ color: 0x3b8fbf, transparent: true, opacity: 0.75 })
          );
          mesh.rotation.x = -Math.PI / 2;
          break;
        case "fence":
          mesh = buildFence(item.length ?? 8, item.axis ?? "x", item.color ? Number(item.color) : undefined);
          break;
        case "arch":
          mesh = buildArch(item.color ? Number(item.color) : undefined);
          break;
        case "banner":
          mesh = buildBanner(item.color ? Number(item.color) : undefined);
          break;
        case "bridge":
          mesh = buildBridge(item.length ?? 6, item.width ?? 2.6, item.color ? Number(item.color) : undefined);
          break;
        case "path":
          mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(item.width ?? 20, item.depth ?? 6),
            new THREE.MeshStandardMaterial({ color: item.color ? Number(item.color) : 0xc2aa79 })
          );
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.y = 0.05;
          break;
        case "hill":
          mesh = buildHill(item.radius ?? 6, item.height ?? 2.6, item.color ? Number(item.color) : undefined);
          break;
        case "stump":
          mesh = buildStump(item.radius ?? 0.45, item.height ?? 0.5, item.color ? Number(item.color) : undefined);
          break;
        case "lantern":
          mesh = buildLantern(item.color ? Number(item.color) : undefined);
          break;
        default:
          break;
      }

      if (!mesh) return;
      mesh.position.set(item.x, item.y || 0, item.z);
      if (item.scale) {
        mesh.scale.setScalar(item.scale);
      }
      mesh.castShadow = false;
      group.add(mesh);
    });

    this.worldGroup.add(group);
    this.loaded.set(region.id, { group, metadata });
    this.loading.delete(region.id);

    return this.loaded.get(region.id);
  }

  get(regionId) {
    return this.loaded.get(regionId);
  }

  setActiveRegion(activeIndex, radius = 1) {
    this.loaded.forEach((entry) => {
      const regionIndex = entry.group.userData.index ?? 0;
      const visible = Math.abs(regionIndex - activeIndex) <= radius;
      entry.group.visible = visible;
    });
  }
}

export { RegionLoader };
