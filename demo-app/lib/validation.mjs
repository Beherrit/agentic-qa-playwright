// Checkout form rules. Returns { error } or { values } so the caller never
// has to guess whether the values were trimmed.
const POSTCODE = /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/;

export function validateCheckout(input, bugs = new Set()) {
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');
  const values = {
    firstName: clean(input?.firstName),
    lastName: clean(input?.lastName),
    postcode: clean(input?.postcode),
  };
  if (!values.firstName) return { error: 'First name is required' };
  if (!values.lastName) return { error: 'Last name is required' };
  // BUG(postcode-optional): an empty postcode is let through
  const postcodeRequired = !bugs.has('postcode-optional');
  if (!values.postcode && postcodeRequired) return { error: 'Postcode is required' };
  if (values.postcode && !POSTCODE.test(values.postcode)) {
    return { error: 'Postcode must be 2 to 10 letters, digits, spaces or hyphens' };
  }
  if (values.firstName.length > 50 || values.lastName.length > 50) {
    return { error: 'Names must be 50 characters or fewer' };
  }
  return { values };
}
