import { test, describe } from 'node:test'
import assert from 'node:assert'
import { validateFeatureFlagName } from './validations.ts'

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
