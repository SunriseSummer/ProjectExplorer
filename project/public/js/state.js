export const State = {
  annotations: {},
  tree: null,
  project: '',
  rowByPath: new Map(),
  nodeByPath: new Map(),
  activePath: '',
};

export const ChatState = {
  messages: [],
  abortController: null,
  currentPath: '',
  currentType: 'dir',
  streaming: false,
  streamElement: null,
  streamTimer: null,
  thinkingElement: null,
  analysisElement: null,
  buffer: '',
  displayed: '',
};
