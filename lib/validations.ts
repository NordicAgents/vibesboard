/**
 * Validation utilities for multi-tenant system
 */

/**
 * Validates tenant slug format
 * - Must be lowercase alphanumeric with hyphens
 * - Must start and end with alphanumeric character
 * - Length between 3 and 50 characters
 */
export function validateTenantSlug(slug: string): boolean {
    if (!slug || slug.length < 3 || slug.length > 50) {
        return false
    }

    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    return slugRegex.test(slug)
}

/**
 * Validates hex color code
 */
export function validateHexColor(color: string): boolean {
    if (!color) return false
    const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/
    return hexRegex.test(color)
}

/**
 * Validates branding colors
 */
export function validateBrandingColors(
    primary: string,
    secondary: string
): boolean {
    return validateHexColor(primary) && validateHexColor(secondary)
}

/**
 * Validates feature flag name
 * - Must be UPPER_SNAKE_CASE
 * - Length between 3 and 50 characters
 */
export function validateFeatureFlagName(name: string): boolean {
    if (!name || name.length < 3 || name.length > 50) {
        return false
    }

    const nameRegex = /^[A-Z][A-Z0-9_]*$/
    return nameRegex.test(name)
}

/**
 * Validates email address
 */
export function validateEmail(email: string): boolean {
    if (!email) return false
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
}

/**
 * Generate slug from name
 */
export function generateSlug(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
        .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
}

/**
 * Validates URL format
 */
export function validateUrl(url: string): boolean {
    if (!url) return false
    try {
        new URL(url)
        return true
    } catch {
        return false
    }
}

/**
 * Validates tenant name
 * - Length between 2 and 100 characters
 * - No special characters except spaces, hyphens, and underscores
 */
export function validateTenantName(name: string): boolean {
    if (!name || name.length < 2 || name.length > 100) {
        return false
    }

    const nameRegex = /^[a-zA-Z0-9\s\-_]+$/
    return nameRegex.test(name)
}
