import { Moon01, Sun, Check, AlertCircle, Settings01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { useTheme } from "@/providers/theme-provider";
import { useAccountSettings } from "@/providers/account-settings-provider";
import { BadgeWithDot } from "@/components/base/badges/badges";

export const HomeScreen = () => {
    const { theme, setTheme } = useTheme();
    const { accountSettings, loading, error } = useAccountSettings();

    const toggleTheme = () => {
        setTheme(theme === "dark" ? "light" : "dark");
    };

    return (
        <div className="min-h-screen bg-primary p-8">
            <div className="mx-auto max-w-4xl space-y-8">
                {/* Header */}
                <div className="text-center">
                    <h1 className="text-display-sm font-semibold text-primary">
                        Live2VOD - Demo de Estilos
                    </h1>
                    <p className="mt-2 text-lg text-tertiary">
                        Esta página demuestra que live2vod tiene los mismos estilos y configuraciones que insight-cms-2
                    </p>
                </div>

                {/* Account Settings Status */}
                <section className="rounded-xl border border-secondary bg-primary p-6 shadow-sm">
                    <h2 className="mb-4 text-lg font-semibold text-primary">
                        📡 AccountSettingsProvider Status
                    </h2>
                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="rounded-lg bg-secondary p-4">
                            <p className="text-sm text-tertiary">Estado</p>
                            <div className="mt-1 flex items-center gap-2">
                                {loading ? (
                                    <BadgeWithDot color="warning" size="md">Cargando...</BadgeWithDot>
                                ) : error ? (
                                    <BadgeWithDot color="error" size="md">Error</BadgeWithDot>
                                ) : (
                                    <BadgeWithDot color="success" size="md">Conectado</BadgeWithDot>
                                )}
                            </div>
                        </div>
                        <div className="rounded-lg bg-secondary p-4">
                            <p className="text-sm text-tertiary">Color del Cliente</p>
                            <div className="mt-1 flex items-center gap-2">
                                <div 
                                    className="size-6 rounded-full border border-primary"
                                    style={{ backgroundColor: accountSettings?.color || '#4B5563' }}
                                />
                                <span className="font-mono text-sm text-primary">
                                    {accountSettings?.color || 'Cargando...'}
                                </span>
                            </div>
                        </div>
                        <div className="rounded-lg bg-secondary p-4">
                            <p className="text-sm text-tertiary">Título</p>
                            <p className="mt-1 font-medium text-primary">
                                {accountSettings?.title || 'N/A'}
                            </p>
                        </div>
                    </div>
                    {error && (
                        <p className="mt-4 text-sm text-error-primary">
                            ⚠️ {error}
                        </p>
                    )}
                </section>

                {/* Theme Toggle */}
                <section className="rounded-xl border border-secondary bg-primary p-6 shadow-sm">
                    <h2 className="mb-4 text-lg font-semibold text-primary">
                        🎨 ThemeProvider (Light/Dark Mode)
                    </h2>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-primary">Tema actual: <strong>{theme}</strong></p>
                            <p className="text-sm text-tertiary">
                                Mismo comportamiento que insight-cms-2
                            </p>
                        </div>
                        <Button
                            color="secondary"
                            size="md"
                            iconLeading={theme === "dark" ? Sun : Moon01}
                            onClick={toggleTheme}
                        >
                            Cambiar a {theme === "dark" ? "Light" : "Dark"}
                        </Button>
                    </div>
                </section>

                {/* Buttons */}
                <section className="rounded-xl border border-secondary bg-primary p-6 shadow-sm">
                    <h2 className="mb-4 text-lg font-semibold text-primary">
                        🔘 Botones (Brand Colors)
                    </h2>
                    <div className="flex flex-wrap gap-3">
                        <Button color="primary" size="md" iconLeading={Check}>
                            Primary
                        </Button>
                        <Button color="secondary" size="md" iconLeading={Settings01}>
                            Secondary
                        </Button>
                        <Button color="tertiary" size="md">
                            Tertiary
                        </Button>
                        <Button color="primary-destructive" size="md" iconLeading={AlertCircle}>
                            Destructive
                        </Button>
                        <Button color="link-color" size="md">
                            Link Color
                        </Button>
                    </div>
                    <p className="mt-4 text-sm text-tertiary">
                        ✅ Los botones Primary usan <code className="rounded bg-secondary px-1">bg-brand-solid</code> que se actualiza con el color del cliente
                    </p>
                </section>

               
            </div>
        </div>
    );
};
