import { test, describe } from 'node:test'
import assert from 'node:assert'
import { validateFeatureFlagName, validateEmail } from './validations.ts'

describe('validateFeatureFlagName', () => {
    test('should return true for valid UPPER_SNAKE_CASE names', () => {
        assert.strictEqual(validateFeatureFlagName('FEATURE_FLAG'), true)
        assert.strictEqual(validateFeatureFlagName('FLAG_1'), true)
        assert.strictEqual(validateFeatureFlagName('A_B_C'), true)
        assert.strictEqual(validateFeatureFlagName('MY_NEW_FEATURE_2023'), true)
        assert.strictEqual(validateFeatureFlagName('ABC'), true)
    })

    test('should return false for names shorter than 3 characters', () => {
        assert.strictEqual(validateFeatureFlagName('FE'), false)
        assert.strictEqual(validateFeatureFlagName('A'), false)
        assert.strictEqual(validateFeatureFlagName(''), false)
    })

    test('should return false for names longer than 50 characters', () => {
        const longName = 'A'.repeat(51)
        assert.strictEqual(validateFeatureFlagName(longName), false)
    })

    test('should return true for names exactly 50 characters', () => {
        const exactName = 'A'.repeat(50)
        assert.strictEqual(validateFeatureFlagName(exactName), true)
    })

    test('should return false for names with lowercase letters', () => {
        assert.strictEqual(validateFeatureFlagName('feature_flag'), false)
        assert.strictEqual(validateFeatureFlagName('FeatureFlag'), false)
        assert.strictEqual(validateFeatureFlagName('FEATURE_fLAG'), false)
    })

    test('should return false for names starting with a number or underscore', () => {
        assert.strictEqual(validateFeatureFlagName('1_FEATURE'), false)
        assert.strictEqual(validateFeatureFlagName('_FEATURE'), false)
    })

    test('should return false for names with invalid symbols or spaces', () => {
        assert.strictEqual(validateFeatureFlagName('FEATURE-FLAG'), false)
        assert.strictEqual(validateFeatureFlagName('FEATURE FLAG'), false)
        assert.strictEqual(validateFeatureFlagName('FEATURE.FLAG'), false)
        assert.strictEqual(validateFeatureFlagName('FEATURE!'), false)
    })

    test('should return false for null or undefined names', () => {
        // @ts-ignore
        assert.strictEqual(validateFeatureFlagName(null), false)
        // @ts-ignore
        assert.strictEqual(validateFeatureFlagName(undefined), false)
    })
})

describe('validateEmail', () => {
    test('should return true for standard valid emails', () => {
        assert.strictEqual(validateEmail('test@example.com'), true)
        assert.strictEqual(validateEmail('user.name@domain.co'), true)
        assert.strictEqual(validateEmail('user_name@domain.org'), true)
    })

    test('should return true for emails with subdomains', () => {
        assert.strictEqual(validateEmail('user@mail.example.com'), true)
        assert.strictEqual(validateEmail('user@sub.domain.co.uk'), true)
    })

    test('should return true for emails with special characters', () => {
        assert.strictEqual(validateEmail('user+tag@example.com'), true)
        assert.strictEqual(validateEmail('user-name@example.com'), true)
        assert.strictEqual(validateEmail('123user@example.com'), true)
    })

    test('should return false for emails without domain extension', () => {
        assert.strictEqual(validateEmail('user@example'), false)
        assert.strictEqual(validateEmail('user@localhost'), false)
    })

    test('should return false for emails without @ symbol', () => {
        assert.strictEqual(validateEmail('userexample.com'), false)
        assert.strictEqual(validateEmail('user.example.com'), false)
    })

    test('should return false for emails with spaces', () => {
        assert.strictEqual(validateEmail('user @example.com'), false)
        assert.strictEqual(validateEmail('user@ example.com'), false)
        assert.strictEqual(validateEmail('user@example .com'), false)
    })

    test('should return false for empty strings', () => {
        assert.strictEqual(validateEmail(''), false)
    })

    test('should return false for null or undefined inputs', () => {
        // @ts-ignore
        assert.strictEqual(validateEmail(null), false)
        // @ts-ignore
        assert.strictEqual(validateEmail(undefined), false)
    })
})
