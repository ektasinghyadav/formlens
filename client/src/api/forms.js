// api/forms.js - Axios wrappers for the admin form endpoints. Requirements: FR-1.1-1.4.
import api from './client.js';

export const listForms = () => api.get('/forms');
export const getForm = (formId) => api.get(`/forms/${formId}`);
export const createForm = (form) => api.post('/forms', form);
export const updateForm = (formId, form) => api.put(`/forms/${formId}`, form);
export const publishForm = (formId) => api.patch(`/forms/${formId}/publish`);
export const unpublishForm = (formId) => api.patch(`/forms/${formId}/unpublish`);
