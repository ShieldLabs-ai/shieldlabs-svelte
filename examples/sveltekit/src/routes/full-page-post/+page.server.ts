import { signup } from '$lib/server/signup';
import type { Actions } from './$types';

export const actions = {
  default: signup,
} satisfies Actions;
