import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bug,
  Database,
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

function ProjectTree({ project, activeView, setActiveView }) {
  const views = [
    { id: 'topology', label: 'Topology', icon: Activity },
    { id: 'events', label: 'Event List', icon: Bug },
    { id: 'reports', label: 'Reports', icon: FileText }
  ];

  return (
    <aside className="dock-panel left-dock">
      <div className="dock-title">Project Explorer</div>
      <div className="tree-root">
        <div className="tree-line tree-project">
          <Database size={15} />
          <span>{project.title}</span>
        </div>
        <div className="tree-children">
          {views.map((view) => {
            const Icon = view.icon;
            return (
              <button
                className={`tree-line tree-button ${activeView === view.id ? 'is-selected' : ''}`}
                key={view.id}
                onClick={() => setActiveView(view.id)}
              >
                <Icon size={14} />
                <span>{view.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="property-grid">
        <div className="property-row">
          <span>Year</span>
          <strong>2015~</strong>
        </div>
        <div className="property-row">
          <span>Data</span>
          <strong>JSON</strong>
        </div>
        <div className="property-row">
          <span>Mode</span>
          <strong>Sanitized</strong>
        </div>
      </div>
    </aside>
  );
}

function TopologyCanvas({ scenario, currentTime, selectedNodeId, setSelectedNodeId }) {
  const nodeStates = useMemo(
    () => classifyNodes(scenario.nodes, scenario.events, currentTime),
    [scenario.events, scenario.nodes, currentTime]
  );
  const nodeById = useMemo(() => new Map(scenario.nodes.map((node) => [node.id, node])), [scenario.nodes]);

  return (
    <div className="topology-frame">
      <svg viewBox="0 0 100 80" role="img" aria-label="Network topology replay">
        <defs>
          <linearGradient id="surfaceGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f8faf7" />
            <stop offset="100%" stopColor="#e8ece7" />
          </linearGradient>
          <pattern id="grid" width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M 8 0 L 0 0 0 8" fill="none" stroke="#d9ded6" strokeWidth="0.2" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="100" height="80" fill="url(#surfaceGradient)" />
        <rect x="0" y="0" width="100" height="80" fill="url(#grid)" />

        {scenario.links.map((link) => {
          const source = nodeById.get(link.source);
          const target = nodeById.get(link.target);
          const active = isActiveLink(link, scenario.events, currentTime);

          return (
            <g key={`${link.source}-${link.target}`}>
              <line
                className={`network-link ${active ? 'is-active' : ''}`}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
              />
              <text className="link-label" x={(source.x + target.x) / 2} y={(source.y + target.y) / 2 - 1}>
                {link.bandwidth}%
              </text>
            </g>
          );
        })}

        {scenario.nodes.map((node) => {
          const state = nodeStates.get(node.id);
          const selected = selectedNodeId === node.id;

          return (
            <g
              key={node.id}
              className={`topology-node node-${node.type} state-${state} ${selected ? 'is-selected' : ''}`}
              transform={`translate(${node.x} ${node.y})`}
              onClick={() => setSelectedNodeId(node.id)}
            >
              <circle r={selected ? 4.9 : 4.2} />
              <text className="node-code" y="1.1">
                {node.type === 'router' ? 'R' : node.type === 'server' ? 'S' : node.type === 'sensor' ? 'N' : 'W'}
              </text>
              <text className="node-label" y="8">
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
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
        <ProjectTree project={project} activeView={activeView} setActiveView={setActiveView} />

        <section className="main-panel">
          <div className="document-tabs">
            <button className={activeView === 'topology' ? 'is-active' : ''} onClick={() => setActiveView('topology')}>
              Topology View
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
