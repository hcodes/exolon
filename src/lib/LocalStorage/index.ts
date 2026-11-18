const localStorageInMemory: Record<string, string> = {};

export function setLocalStorageItem(key: string, value: unknown, throwOnError = false) {
    localStorageInMemory[key] = String(value);

    try {
        window.localStorage.setItem(key, String(value));
        return true;
    } catch (error) {
        if (throwOnError) {
            throw error;
        }
        return false;
    }
}

export function getLocalStorageItem(key: string, fallbackToMemory = true) {
    try {
        return window.localStorage.getItem(key);
    } catch (error) {
        if (!fallbackToMemory) {
            throw error;
        }
        return localStorageInMemory[key];
    }
}

export function removeLocalStorageItem(key: string, throwOnError = false) {
    delete localStorageInMemory[key];

    try {
        window.localStorage.removeItem(key);
        return true;
    } catch (error) {
        if (throwOnError) {
            throw error;
        }
        return false;
    }
}
