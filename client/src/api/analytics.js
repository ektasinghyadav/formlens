// api/analytics.js - Axios wrappers for the analytics endpoints. Requirements: FR-5.x, FR-6.2, FR-7.2.
// `range` is { from, to } as 'YYYY-MM-DD' strings; blank means "no limit".
import api from './client.js';

const params = ({ from, to } = {}) => ({ ...(from ? { from } : {}), ...(to ? { to } : {}) });

export const getSummary = (formId, range) => api.get(`/analytics/${formId}/summary`, { params: params(range) });
export const getFunnel = (formId, range) => api.get(`/analytics/${formId}/funnel`, { params: params(range) });
export const getFields = (formId, range) => api.get(`/analytics/${formId}/fields`, { params: params(range) });
export const getRecommendations = (formId, range) => api.get(`/analytics/${formId}/recommendations`, { params: params(range) });
