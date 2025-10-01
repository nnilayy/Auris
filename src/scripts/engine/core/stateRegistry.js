const pipelines = new Map();

export function safeCloseContext(pipeline) {
  if (!pipeline || !pipeline.context) { return; }
  if (pipeline._closed) { return; }
  try {
    if (pipeline.context.state !== 'closed') {
      pipeline.context.close();
    }
  } catch {
  }
  pipeline._closed = true;
}

export function getPipeline(streamId) {
  return pipelines.get(streamId);
}

export function setPipeline(streamId, data) {
  pipelines.set(streamId, data);
  return data;
}

export function hasPipeline(streamId) {
  return pipelines.has(streamId);
}

export function deletePipeline(streamId) {
  const p = pipelines.get(streamId);
  if (p) {
    safeCloseContext(p);
  }
  pipelines.delete(streamId);
}

export function listPipelines() {
  return Array.from(pipelines.keys());
}
