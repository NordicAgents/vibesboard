import { describe, it, expect } from 'vitest'
import { validateFeatureFlagName, validateEmail } from './validations.ts'

describe('validateFeatureFlagName', () => {
  it('should return true for valid UPPER_SNAKE_CASE names', () => {
    expect(validateFeatureFlagName('FEATURE_FLAG')).toBe(true)
    expect(validateFeatureFlagName('FLAG_1')).toBe(true)
    expect(validateFeatureFlagName('A_B_C')).toBe(true)
    expect(validateFeatureFlagName('MY_NEW_FEATURE_2023')).toBe(true)
    expect(validateFeatureFlagName('ABC')).toBe(true)
  })

  it('should return false for names shorter than 3 characters', () => {
    expect(validateFeatureFlagName('FE')).toBe(false)
    expect(validateFeatureFlagName('A')).toBe(false)
    expect(validateFeatureFlagName('')).toBe(false)
  })

  it('should return false for names longer than 50 characters', () => {
    const longName = 'A'.repeat(51)
    expect(validateFeatureFlagName(longName)).toBe(false)
  })

  it('should return true for names exactly 50 characters', () => {
    const exactName = 'A'.repeat(50)
    expect(validateFeatureFlagName(exactName)).toBe(true)
  })

  it('should return false for names with lowercase letters', () => {
    expect(validateFeatureFlagName('feature_flag')).toBe(false)
    expect(validateFeatureFlagName('FeatureFlag')).toBe(false)
    expect(validateFeatureFlagName('FEATURE_fLAG')).toBe(false)
  })

  it('should return false for names starting with a number or underscore', () => {
    expect(validateFeatureFlagName('1_FEATURE')).toBe(false)
    expect(validateFeatureFlagName('_FEATURE')).toBe(false)
  })

  it('should return false for names with invalid symbols or spaces', () => {
    expect(validateFeatureFlagName('FEATURE-FLAG')).toBe(false)
    expect(validateFeatureFlagName('FEATURE FLAG')).toBe(false)
    expect(validateFeatureFlagName('FEATURE.FLAG')).toBe(false)
    expect(validateFeatureFlagName('FEATURE!')).toBe(false)
  })

  it('should return false for null or undefined names', () => {
    // @ts-ignore
    expect(validateFeatureFlagName(null)).toBe(false)
    // @ts-ignore
    expect(validateFeatureFlagName(undefined)).toBe(false)
  })
})

describe('validateEmail', () => {
  it('should return true for standard valid emails', () => {
    expect(validateEmail('test@example.com')).toBe(true)
    expect(validateEmail('user.name@domain.co')).toBe(true)
    expect(validateEmail('user_name@domain.org')).toBe(true)
  })

  it('should return true for emails with subdomains', () => {
    expect(validateEmail('user@mail.example.com')).toBe(true)
    expect(validateEmail('user@sub.domain.co.uk')).toBe(true)
  })

  it('should return true for emails with special characters', () => {
    expect(validateEmail('user+tag@example.com')).toBe(true)
    expect(validateEmail('user-name@example.com')).toBe(true)
    expect(validateEmail('123user@example.com')).toBe(true)
  })

  it('should return false for emails without domain extension', () => {
    expect(validateEmail('user@example')).toBe(false)
    expect(validateEmail('user@localhost')).toBe(false)
  })

  it('should return false for emails without @ symbol', () => {
    expect(validateEmail('userexample.com')).toBe(false)
    expect(validateEmail('user.example.com')).toBe(false)
  })

  it('should return false for emails with spaces', () => {
    expect(validateEmail('user @example.com')).toBe(false)
    expect(validateEmail('user@ example.com')).toBe(false)
    expect(validateEmail('user@example .com')).toBe(false)
  })

  it('should return false for empty strings', () => {
    expect(validateEmail('')).toBe(false)
  })

  it('should return false for null or undefined inputs', () => {
    // @ts-ignore
    expect(validateEmail(null)).toBe(false)
    // @ts-ignore
    expect(validateEmail(undefined)).toBe(false)
  })
})
