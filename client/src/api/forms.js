// api/forms.js - Axios wrappers for the admin form endpoints. Requirements: FR-1.1-1.4.
import api from './client.js';

export const listForms = () => api.get('/forms');
export const getForm = (formId) => api.get(`/forms/${formId}`);
export const createForm = (form) => api.post('/forms', form);
export const updateForm = (formId, form) => api.put(`/forms/${formId}`, form);
export const publishForm = (formId) => api.patch(`/forms/${formId}/publish`);
export const unpublishForm = (formId) => api.patch(`/forms/${formId}/unpublish`);

// ---- public (respondent) endpoints: no login needed ----
export const getPublicForm = (shareLink) => api.get(`/forms/${shareLink}/public`);
export const createSession = (formId) => api.post('/sessions', { form_id: formId });
export const submitForm = (formId, body) => api.post(`/forms/${formId}/submit`, body);
export const uploadFile = (formId, fieldId, file) => {
  const data = new FormData();
  data.append('file', file);
  return api.post(`/forms/${formId}/upload`, data, { params: { field_id: fieldId } });
};
