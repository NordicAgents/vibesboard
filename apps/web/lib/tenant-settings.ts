export function canShowGoogleReview(
  isPersonal: boolean,
  googleReviewEnabled: boolean
): boolean {
  return !isPersonal && googleReviewEnabled
}
