import { MealService } from '@prisma/client';

export const MEAL_PRICES_XOF: Record<MealService, number> = {
  [MealService.BREAKFAST]: 50,
  [MealService.LUNCH]: 100,
  [MealService.DINNER]: 100,
};
