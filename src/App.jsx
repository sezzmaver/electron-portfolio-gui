import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  Activity,
  Bug,
  FileText,
  Monitor,
  Pause,
  Play,
  Radar,
  RotateCcw,
  Router,
  Search,
  Server,
  ShieldCheck,
  StepForward
} from 'lucide-react';
import projects from './data/projects.json';

const EVENT_LABELS = {
  scan: 'Scan',
  'attack-send': 'Attack',
  infection: 'Infection',
  defense: 'Defense',
  remedy: 'Remedy'
};

const TYPE_ICONS = {
  router: Router,
  server: Server,
  workstation: Monitor,
  sensor: Radar
};

function formatTime(seconds) {
  const minute = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minute}:${sec}`;
}

function classifyNodes(nodes, events, currentTime) {
  const state = new Map(nodes.map((node) => [node.id, 'normal']));

  events
    .filter((event) => event.time <= currentTime)
    .forEach((event) => {
      if (event.type === 'infection') {
        state.set(event.target, 'infected');
      }
      if (event.type === 'defense') {
        state.set(event.target, 'defended');
      }
      if (event.type === 'remedy') {
        state.set(event.target, 'restored');
      }
    });

  return state;
}

function isActiveLink(link, events, currentTime) {
  return events.some((event) => {
    const sameDirection = event.source === link.source && event.target === link.target;
    const reverseDirection = event.source === link.target && event.target === link.source;
    const inWindow = currentTime >= event.time && currentTime - event.time <= 10;
    return inWindow && (sameDirection || reverseDirection);
  });
}

function metricAtTime(metrics, currentTime) {
  return metrics.reduce((latest, metric) => (metric.time <= currentTime ? metric : latest), metrics[0]);
}

function ToolbarButton({ icon: Icon, title, active, onClick }) {
  return (
    <button className={`tool-button ${active ? 'is-active' : ''}`} title={title} onClick={onClick}>
      <Icon size={16} strokeWidth={2} />
    </button>
  );
}

const NODE_COLORS = {
  router: 0x2d527b,
  server: 0x6f7c35,
  workstation: 0x9a6a31,
  sensor: 0x654f86
};

const STATE_COLORS = {
  normal: null,
  infected: 0xb13f4b,
  defended: 0x347a43,
  restored: 0x4c9b5d
};

function nodePosition(node) {
  const x = (node.x - 50) * 0.16;
  const y = node.z ?? 0.55;
  const z = (node.y - 42) * 0.14;
  return new THREE.Vector3(x, y, z);
}

function nodeColor(node, state) {
  return STATE_COLORS[state] ?? NODE_COLORS[node.type] ?? 0x50605c;
}

function createNodeGeometry(type) {
  if (type === 'router') {
    return new THREE.CylinderGeometry(0.34, 0.4, 0.32, 32);
  }

  if (type === 'server') {
    return new THREE.BoxGeometry(0.56, 0.56, 0.56);
  }

  if (type === 'sensor') {
    return new THREE.OctahedronGeometry(0.38);
  }

  return new THREE.SphereGeometry(0.34, 32, 18);
}

function createLabelSprite(text) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = 512;
  canvas.height = 128;

  context.fillStyle = 'rgba(250, 252, 250, 0.9)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(77, 90, 84, 0.45)';
  context.lineWidth = 4;
  context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  context.fillStyle = '#1d2427';
  context.font = '600 34px Segoe UI, Arial, sans-serif';
  context.textBaseline = 'middle';
  context.fillText(text, 26, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.9, 0.48, 1);
  return sprite;
}

function TopologyCanvas({ scenario, currentTime, selectedNodeId, setSelectedNodeId }) {
  const containerRef = useRef(null);
  const graphRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef1ed);

    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
    camera.position.set(0, 7.2, 10.2);
    camera.lookAt(0, 0.4, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const sceneLight = new THREE.HemisphereLight(0xffffff, 0xaab4ae, 2.6);
    scene.add(sceneLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(4, 9, 6);
    scene.add(keyLight);

    const graphGroup = new THREE.Group();
    graphGroup.rotation.y = -0.35;
    scene.add(graphGroup);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 9),
      new THREE.MeshStandardMaterial({
        color: 0xdfe6df,
        roughness: 0.82,
        metalness: 0.03
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.04;
    graphGroup.add(floor);

    const grid = new THREE.GridHelper(13, 26, 0x899a94, 0xc5cec9);
    grid.position.y = -0.02;
    graphGroup.add(grid);

    const positions = new Map(scenario.nodes.map((node) => [node.id, nodePosition(node)]));
    const nodeEntries = [];
    const linkEntries = [];
    const pulseEntries = [];
    const selectableMeshes = [];

    scenario.links.forEach((link) => {
      const source = positions.get(link.source);
      const target = positions.get(link.target);
      if (!source || !target) {
        return;
      }

      const geometry = new THREE.BufferGeometry().setFromPoints([source, target]);
      const material = new THREE.LineBasicMaterial({
        color: 0x5d6f6a,
        transparent: true,
        opacity: 0.72
      });
      const line = new THREE.Line(geometry, material);
      graphGroup.add(line);
      linkEntries.push({ link, line, material });

      const pulse = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 16, 12),
        new THREE.MeshBasicMaterial({
          color: 0xd46b2f,
          transparent: true,
          opacity: 0.88
        })
      );
      pulse.visible = false;
      graphGroup.add(pulse);
      pulseEntries.push({ link, mesh: pulse, source, target });
    });

    scenario.nodes.forEach((node) => {
      const material = new THREE.MeshStandardMaterial({
        color: nodeColor(node, 'normal'),
        roughness: 0.46,
        metalness: 0.18
      });
      const mesh = new THREE.Mesh(createNodeGeometry(node.type), material);
      mesh.position.copy(positions.get(node.id));
      mesh.userData.nodeId = node.id;
      graphGroup.add(mesh);
      selectableMeshes.push(mesh);
      nodeEntries.push({ node, mesh, material });

      const label = createLabelSprite(node.label);
      label.position.copy(mesh.position);
      label.position.y += 0.68;
      graphGroup.add(label);
    });

    const selectedRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.52, 0.035, 12, 48),
      new THREE.MeshBasicMaterial({
        color: 0x1f5c56,
        transparent: true,
        opacity: 0.92
      })
    );
    selectedRing.rotation.x = Math.PI / 2;
    graphGroup.add(selectedRing);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDown = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;

    const handlePointerDown = (event) => {
      pointerDown = true;
      moved = false;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event) => {
      if (!pointerDown) {
        return;
      }

      const deltaX = event.clientX - lastX;
      const deltaY = event.clientY - lastY;
      moved = moved || Math.abs(deltaX) + Math.abs(deltaY) > 4;
      graphGroup.rotation.y += deltaX * 0.006;
      graphGroup.rotation.x = Math.max(-0.65, Math.min(0.45, graphGroup.rotation.x + deltaY * 0.004));
      lastX = event.clientX;
      lastY = event.clientY;
    };

    const handlePointerUp = (event) => {
      pointerDown = false;
      renderer.domElement.releasePointerCapture(event.pointerId);

      if (moved) {
        return;
      }

      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const [hit] = raycaster.intersectObjects(selectableMeshes, false);
      if (hit?.object?.userData?.nodeId) {
        setSelectedNodeId(hit.object.userData.nodeId);
      }
    };

    const handleWheel = (event) => {
      event.preventDefault();
      camera.position.z = Math.max(6.8, Math.min(14.2, camera.position.z + event.deltaY * 0.006));
      camera.lookAt(0, 0.4, 0);
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const clock = new THREE.Clock();
    let frameId = 0;
    const animate = () => {
      const elapsed = clock.getElapsedTime();
      pulseEntries.forEach((entry, index) => {
        if (!entry.mesh.visible) {
          return;
        }

        const ratio = (elapsed * 0.55 + index * 0.17) % 1;
        entry.mesh.position.lerpVectors(entry.source, entry.target, ratio);
      });

      selectedRing.rotation.z += 0.018;
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(animate);
    };
    animate();

    graphRef.current = {
      graphGroup,
      nodeEntries,
      linkEntries,
      pulseEntries,
      selectedRing,
      positions,
      scene,
      renderer
    };

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('wheel', handleWheel);
      graphRef.current = null;

      scene.traverse((object) => {
        if (object.geometry) {
          object.geometry.dispose();
        }

        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            if (material.map) {
              material.map.dispose();
            }
            material.dispose();
          });
        }
      });

      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [scenario, setSelectedNodeId]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) {
      return;
    }

    const nodeStates = classifyNodes(scenario.nodes, scenario.events, currentTime);

    graph.nodeEntries.forEach(({ node, mesh, material }) => {
      const state = nodeStates.get(node.id);
      const selected = selectedNodeId === node.id;
      material.color.setHex(nodeColor(node, state));
      material.emissive.setHex(state === 'infected' ? 0x4a1117 : selected ? 0x0b4f4a : 0x000000);
      material.emissiveIntensity = state === 'infected' || selected ? 0.28 : 0;
      mesh.scale.setScalar(selected ? 1.2 : 1);
    });

    graph.linkEntries.forEach(({ link, material }) => {
      const active = isActiveLink(link, scenario.events, currentTime);
      material.color.setHex(active ? 0xc96a2c : 0x5d6f6a);
      material.opacity = active ? 1 : 0.72;
      material.needsUpdate = true;
    });

    graph.pulseEntries.forEach(({ link, mesh }) => {
      mesh.visible = isActiveLink(link, scenario.events, currentTime);
    });

    const selectedPosition = graph.positions.get(selectedNodeId);
    graph.selectedRing.visible = Boolean(selectedPosition);
    if (selectedPosition) {
      graph.selectedRing.position.copy(selectedPosition);
      graph.selectedRing.position.y += 0.03;
    }
  }, [scenario, currentTime, selectedNodeId]);

  return (
    <div className="topology-frame webgl-frame">
      <div ref={containerRef} className="webgl-canvas" aria-label="3D network topology replay" />
    </div>
  );
}

function EventTable({ events, currentTime, onSelectTime }) {
  return (
    <div className="event-table">
      <div className="table-header">
        <span>Time</span>
        <span>Type</span>
        <span>Route</span>
      </div>
      {events.map((event) => {
        const active = event.time <= currentTime;
        return (
          <button
            key={`${event.time}-${event.label}`}
            className={`event-row ${active ? 'is-fired' : ''}`}
            onClick={() => onSelectTime(event.time)}
          >
            <span>{formatTime(event.time)}</span>
            <span>{EVENT_LABELS[event.type]}</span>
            <span>{event.source} {'->'} {event.target}</span>
          </button>
        );
      })}
    </div>
  );
}

function MetricStrip({ metrics, currentTime }) {
  const metric = metricAtTime(metrics, currentTime);
  const pointsTraffic = metrics.map((item) => `${item.time / 1.2},${48 - item.traffic / 2}`).join(' ');
  const pointsRisk = metrics.map((item) => `${item.time / 1.2},${48 - item.risk / 2}`).join(' ');

  return (
    <div className="metric-strip">
      <div className="metric-numbers">
        <div>
          <span>Traffic</span>
          <strong>{metric.traffic}%</strong>
        </div>
        <div>
          <span>Risk</span>
          <strong>{metric.risk}%</strong>
        </div>
      </div>
      <svg viewBox="0 0 100 54" aria-label="Traffic and risk chart">
        <polyline className="metric-line traffic" points={pointsTraffic} />
        <polyline className="metric-line risk" points={pointsRisk} />
        <line className="metric-cursor" x1={currentTime / 1.2} y1="4" x2={currentTime / 1.2} y2="50" />
      </svg>
    </div>
  );
}

function Inspector({ scenario, selectedNodeId, currentTime }) {
  const selected = scenario.nodes.find((node) => node.id === selectedNodeId) ?? scenario.nodes[0];
  const nodeStates = classifyNodes(scenario.nodes, scenario.events, currentTime);
  const Icon = TYPE_ICONS[selected.type] ?? Server;

  return (
    <aside className="dock-panel right-dock">
      <div className="dock-title">Inspector</div>
      <div className="node-inspector">
        <div className="inspector-head">
          <Icon size={22} />
          <div>
            <strong>{selected.label}</strong>
            <span>{selected.id}</span>
          </div>
        </div>
        <div className="property-grid compact">
          <div className="property-row">
            <span>Type</span>
            <strong>{selected.type}</strong>
          </div>
          <div className="property-row">
            <span>Priority</span>
            <strong>{selected.priority}</strong>
          </div>
          <div className="property-row">
            <span>State</span>
            <strong>{nodeStates.get(selected.id)}</strong>
          </div>
        </div>
      </div>
      <div className="dock-title secondary">Reports</div>
      <div className="report-list">
        {scenario.reports.map((report) => (
          <div className="report-row" key={report.id}>
            <FileText size={15} />
            <span>{report.name}</span>
            <strong>{report.status}</strong>
          </div>
        ))}
      </div>
    </aside>
  );
}

function App() {
  const [projectId, setProjectId] = useState(projects[0].id);
  const [activeView, setActiveView] = useState('topology');
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedNodeId, setSelectedNodeId] = useState('core');

  const project = projects.find((item) => item.id === projectId) ?? projects[0];
  const scenario = project.scenario;

  useEffect(() => {
    if (!isPlaying) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setCurrentTime((time) => {
        const next = Math.min(scenario.duration, time + speed);
        if (next >= scenario.duration) {
          setIsPlaying(false);
        }
        return next;
      });
    }, 320);

    return () => window.clearInterval(timer);
  }, [isPlaying, scenario.duration, speed]);

  const currentEvents = scenario.events.filter((event) => event.time <= currentTime);
  const activeEvent = currentEvents[currentEvents.length - 1];

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="title-cluster">
          <div className="window-mark" />
          <h1>포트폴리오</h1>
        </div>
        <label className="project-picker">
          <span>Project</span>
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <nav className="menu-row">
        <button>File</button>
        <button>View</button>
        <button>Scenario</button>
        <button>Report</button>
      </nav>

      <section className="ribbon">
        <div className="tool-group">
          <ToolbarButton
            icon={isPlaying ? Pause : Play}
            title={isPlaying ? 'Pause' : 'Play'}
            active={isPlaying}
            onClick={() => setIsPlaying((value) => !value)}
          />
          <ToolbarButton
            icon={StepForward}
            title="Step"
            onClick={() => setCurrentTime((time) => Math.min(scenario.duration, time + 5))}
          />
          <ToolbarButton icon={RotateCcw} title="Reset" onClick={() => setCurrentTime(0)} />
        </div>
        <div className="tool-group segmented">
          <ToolbarButton icon={Activity} title="Topology" active={activeView === 'topology'} onClick={() => setActiveView('topology')} />
          <ToolbarButton icon={Bug} title="Events" active={activeView === 'events'} onClick={() => setActiveView('events')} />
          <ToolbarButton icon={FileText} title="Reports" active={activeView === 'reports'} onClick={() => setActiveView('reports')} />
        </div>
        <label className="speed-box">
          <span>Speed</span>
          <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
        </label>
        <div className="search-box">
          <Search size={15} />
          <input aria-label="Search" placeholder="Search" />
        </div>
      </section>

      <main className="workspace">
        <section className="main-panel">
          <div className="document-tabs">
            <button className={activeView === 'topology' ? 'is-active' : ''} onClick={() => setActiveView('topology')}>
              3D Topology
            </button>
            <button className={activeView === 'events' ? 'is-active' : ''} onClick={() => setActiveView('events')}>
              Event Timeline
            </button>
            <button className={activeView === 'reports' ? 'is-active' : ''} onClick={() => setActiveView('reports')}>
              Report Output
            </button>
          </div>

          <div className="document-surface">
            <div className="document-header">
              <div>
                <strong>{project.title}</strong>
                <span>{project.subtitle}</span>
              </div>
              <div className="time-readout">{formatTime(currentTime)} / {formatTime(scenario.duration)}</div>
            </div>

            {activeView === 'topology' && (
              <TopologyCanvas
                scenario={scenario}
                currentTime={currentTime}
                selectedNodeId={selectedNodeId}
                setSelectedNodeId={setSelectedNodeId}
              />
            )}

            {activeView === 'events' && (
              <div className="table-document">
                <EventTable events={scenario.events} currentTime={currentTime} onSelectTime={setCurrentTime} />
              </div>
            )}

            {activeView === 'reports' && (
              <div className="report-document">
                {scenario.reports.map((report) => (
                  <button className="report-tile" key={report.id}>
                    <FileText size={22} />
                    <span>{report.name}</span>
                    <strong>{report.pages} pages</strong>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="timeline-panel">
            <input
              type="range"
              min="0"
              max={scenario.duration}
              value={currentTime}
              onChange={(event) => setCurrentTime(Number(event.target.value))}
            />
            <MetricStrip metrics={scenario.metrics} currentTime={currentTime} />
          </div>
        </section>

        <Inspector scenario={scenario} selectedNodeId={selectedNodeId} currentTime={currentTime} />
      </main>

      <footer className="statusbar">
        <span>{scenario.name}</span>
        <span>{activeEvent ? activeEvent.label : 'Ready'}</span>
        <span>
          <ShieldCheck size={14} />
          Sanitized
        </span>
      </footer>
    </div>
  );
}

export default App;
