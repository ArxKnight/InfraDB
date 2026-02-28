import React, { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle, Database, User, Settings, AlertCircle, Loader2 } from 'lucide-react';
import { normalizeUsername, passwordSchema, usernameSchema } from '@/lib/policy';

const databaseSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.number().min(1).max(65535),
  user: z.string().min(1, 'Username is required'),
  password: z.string(),
  database: z.string().min(1, 'Database name is required'),
  ssl: z.boolean().optional(),
});

const adminSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: passwordSchema('Password'),
  username: usernameSchema('Username', { min: 1, max: 100 }),
});

const adminSchemaOptional = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object') {
      return value;
    }

    const raw = value as Record<string, unknown>;
    const email = String(raw.email ?? '').trim();
    const username = String(raw.username ?? '').trim();
    const password = String(raw.password ?? '').trim();

    // If the admin section was never filled in (common when reusing an existing DB),
    // coerce the object to undefined so validation doesn't block submission.
    if (!email && !username && !password) {
      return undefined;
    }

    return { email, username, password };
  },
  z.union([adminSchema, z.undefined()]),
);

const setupSchema = z
  .object({
    database: databaseSchema,
    reuseExistingDatabase: z.boolean(),
    admin: adminSchemaOptional,
  })
  .superRefine((data, ctx) => {
    if (!data.reuseExistingDatabase && !data.admin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Global admin details are required',
        path: ['admin'],
      });
    }
  });

type SetupFormData = z.infer<typeof setupSchema>;

type ConnectionProbeResult = {
  success: boolean;
  connected: boolean;
  message?: string;
  error?: string;
  databaseExists?: boolean;
  infraDbSchemaDetected?: boolean;
  migrationsUpToDate?: boolean | null;
  latestMigrationId?: string | null;
  existingGlobalAdmin?: { email: string; username: string; role: string } | null;
  schemaDetails?: { missingTables: string[] };
};

const SetupPage: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionError, setConnectionError] = useState<string>('');
  const [setupComplete, setSetupComplete] = useState(false);
  const [connectionProbe, setConnectionProbe] = useState<ConnectionProbeResult | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    unregister,
    formState: { errors },
    trigger,
  } = useForm<SetupFormData>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      database: {
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: '',
        database: 'infradb',
        ssl: false,
      },
      reuseExistingDatabase: false,
      admin: {
        email: '',
        password: '',
        username: '',
      },
    },
  });

  const dbValues = watch('database');
  const reuseExistingDatabase = Boolean(watch('reuseExistingDatabase'));

  useEffect(() => {
    // Register this programmatically so it remains a boolean (set via setValue/watch)
    // and doesn't get coerced through a hidden input's string value.
    register('reuseExistingDatabase');
    return () => unregister('reuseExistingDatabase');
  }, [register, unregister]);

  const canReuseExistingInstallation = useMemo(() => {
    return Boolean(
      connectionProbe?.connected &&
        connectionProbe.databaseExists &&
        connectionProbe.infraDbSchemaDetected &&
        connectionProbe.existingGlobalAdmin,
    );
  }, [connectionProbe]);

  useEffect(() => {
    // If DB settings change after a successful test, require retesting.
    setConnectionStatus('idle');
    setConnectionError('');
    setConnectionProbe(null);
    setValue('reuseExistingDatabase', false, { shouldDirty: true, shouldValidate: false });
  }, [
    dbValues.host,
    dbValues.port,
    dbValues.user,
    dbValues.password,
    dbValues.database,
    dbValues.ssl,
  ]);

  // Test database connection
  const testConnection = async () => {
    setConnectionStatus('testing');
    setConnectionError('');

    try {
      const isValid = await trigger('database');
      if (!isValid) {
        setConnectionStatus('error');
        setConnectionError('Please fix validation errors first');
        return;
      }

      const formData = watch();
      const response = await fetch('/api/setup/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ database: formData.database }),
      });

      const result: ConnectionProbeResult = await response.json();
      setConnectionProbe(result);

      if (result.success && result.connected) {
        setConnectionStatus('success');

        if (
          result.databaseExists &&
          result.infraDbSchemaDetected &&
          result.existingGlobalAdmin
        ) {
          // Default to reuse when we clearly detect an existing InfraDB install.
          setValue('reuseExistingDatabase', true, { shouldDirty: true, shouldValidate: false });
        }
      } else {
        setConnectionStatus('error');
        setConnectionError(result.error || 'Connection failed');
      }
    } catch (error) {
      setConnectionStatus('error');
      setConnectionError('Failed to test connection');
    }
  };

  // Complete setup
  const onSubmit = async (data: SetupFormData) => {
    setIsLoading(true);

    try {
      const payload = data.reuseExistingDatabase
        ? { database: data.database, reuseExistingDatabase: true }
        : data;

      const response = await fetch('/api/setup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (result.success) {
        setSetupComplete(true);
        // Redirect to login after a delay
        setTimeout(() => {
          window.location.href = '/auth/login';
        }, 3000);
      } else {
        throw new Error(result.error || 'Setup failed');
      }
    } catch (error) {
      console.error('Setup error:', error);
      alert(error instanceof Error ? error.message : 'Setup failed');
    } finally {
      setIsLoading(false);
    }
  };

  const nextStep = async () => {
    if (currentStep === 1) {
      const isValid = await trigger('database');
      if (isValid && connectionStatus === 'success') {
        setCurrentStep(2);
      }
    } else if (currentStep === 2) {
      if (reuseExistingDatabase) {
        setCurrentStep(3);
        return;
      }

      const isValid = await trigger('admin');
      if (isValid) {
        setCurrentStep(3);
      }
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  if (setupComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <CardTitle>Setup Complete!</CardTitle>
            <CardDescription>
              InfraDB has been configured successfully. You'll be redirected to the login page shortly.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-6 h-6" />
            InfraDB Setup
          </CardTitle>
          <CardDescription>
            Welcome! Let's configure your InfraDB installation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={currentStep.toString()} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="1" disabled={currentStep < 1}>
                <Database className="w-4 h-4 mr-2" />
                Database
              </TabsTrigger>
              <TabsTrigger value="2" disabled={currentStep < 2}>
                <User className="w-4 h-4 mr-2" />
                Admin User
              </TabsTrigger>
              <TabsTrigger value="3" disabled={currentStep < 3}>
                <CheckCircle className="w-4 h-4 mr-2" />
                Review
              </TabsTrigger>
            </TabsList>

            <form onSubmit={handleSubmit(onSubmit)}>
              <TabsContent value="1" className="space-y-4">
                <div className="space-y-4">
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="mysql-host">Host</Label>
                        <Input
                          id="mysql-host"
                          {...register('database.host')}
                          placeholder="localhost"
                        />
                        {errors.database?.host && (
                          <p className="text-sm text-destructive">{errors.database.host.message}</p>
                        )}
                      </div>
                      <div>
                        <Label htmlFor="mysql-port">Port</Label>
                        <Input
                          id="mysql-port"
                          type="number"
                          {...register('database.port', { valueAsNumber: true })}
                          placeholder="3306"
                        />
                        {errors.database?.port && (
                          <p className="text-sm text-destructive">{errors.database.port.message}</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="mysql-database">Database Name</Label>
                      <Input
                        id="mysql-database"
                        {...register('database.database')}
                        placeholder="infradb"
                      />
                      {errors.database?.database && (
                        <p className="text-sm text-destructive">{errors.database.database.message}</p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="mysql-user">Username</Label>
                        <Input
                          id="mysql-user"
                          {...register('database.user')}
                          placeholder="root"
                        />
                        {errors.database?.user && (
                          <p className="text-sm text-destructive">{errors.database.user.message}</p>
                        )}
                      </div>
                      <div>
                        <Label htmlFor="mysql-password">Password</Label>
                        <Input
                          id="mysql-password"
                          type="password"
                          {...register('database.password')}
                          placeholder="Password"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button type="button" onClick={testConnection} disabled={connectionStatus === 'testing'}>
                      {connectionStatus === 'testing' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Test Connection
                    </Button>
                    {connectionStatus === 'success' && (
                      <div className="flex items-center text-green-600">
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Connected
                      </div>
                    )}
                  </div>

                  {connectionStatus === 'success' && connectionProbe?.databaseExists && connectionProbe?.infraDbSchemaDetected && (
                    <Alert>
                      <Database className="h-4 w-4" />
                      <AlertDescription className="space-y-2">
                        <div>
                          An InfraDB database was detected in <span className="font-medium">{watch('database.database')}</span>.
                        </div>

                        {typeof connectionProbe.migrationsUpToDate === 'boolean' && (
                          <div className="text-sm text-muted-foreground">
                            Schema status:{' '}
                            {connectionProbe.migrationsUpToDate ? 'up to date' : 'out of date'}
                            {connectionProbe.latestMigrationId
                              ? ` (latest migration: ${connectionProbe.latestMigrationId})`
                              : ''}
                            {!connectionProbe.migrationsUpToDate ? ' — setup will run migrations.' : ''}
                          </div>
                        )}

                        {connectionProbe.existingGlobalAdmin ? (
                          <div className="text-sm text-muted-foreground">
                            Existing global admin: {connectionProbe.existingGlobalAdmin.email} ({connectionProbe.existingGlobalAdmin.username})
                          </div>
                        ) : (
                          <div className="text-sm text-destructive">
                            No GLOBAL_ADMIN user was found in this database.
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant={reuseExistingDatabase ? 'default' : 'outline'}
                            onClick={() => setValue('reuseExistingDatabase', true, { shouldDirty: true })}
                            disabled={!canReuseExistingInstallation}
                          >
                            Use existing database
                          </Button>
                          <Button
                            type="button"
                            variant={!reuseExistingDatabase ? 'default' : 'outline'}
                            onClick={() => setValue('reuseExistingDatabase', false, { shouldDirty: true })}
                          >
                            Use a different database name
                          </Button>
                        </div>

                        {!reuseExistingDatabase && (
                          <div className="text-sm text-muted-foreground">
                            Change the “Database Name” field above and re-test the connection.
                          </div>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}

                  {connectionStatus === 'error' && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{connectionError}</AlertDescription>
                    </Alert>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={nextStep}
                    disabled={connectionStatus !== 'success'}
                  >
                    Next
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="2" className="space-y-4">
                {reuseExistingDatabase ? (
                  <Alert>
                    <User className="h-4 w-4" />
                    <AlertDescription className="space-y-2">
                      <div>
                        Using an existing InfraDB database. Global admin credentials will not be requested.
                      </div>
                      {connectionProbe?.existingGlobalAdmin ? (
                        <div className="text-sm text-muted-foreground">
                          Existing global admin: {connectionProbe.existingGlobalAdmin.email} ({connectionProbe.existingGlobalAdmin.username})
                        </div>
                      ) : (
                        <div className="text-sm text-destructive">
                          Could not retrieve an existing global admin user from the database.
                        </div>
                      )}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="admin-email">Global Admin Email</Label>
                      <Input
                        id="admin-email"
                        type="email"
                        {...register('admin.email')}
                        placeholder="admin@example.com"
                      />
                      {errors.admin?.email && (
                        <p className="text-sm text-destructive">{errors.admin.email.message}</p>
                      )}
                    </div>
                    <div>
                      <Label htmlFor="admin-username">Global Admin Username</Label>
                      <Input
                        id="admin-username"
                        {...register('admin.username', { setValueAs: normalizeUsername })}
                        placeholder="admin"
                      />
                      {errors.admin?.username && (
                        <p className="text-sm text-destructive">{errors.admin.username.message}</p>
                      )}
                    </div>
                    <div>
                      <Label htmlFor="admin-password">Global Admin Password</Label>
                      <Input
                        id="admin-password"
                        type="password"
                        {...register('admin.password')}
                        placeholder="Minimum 8 characters"
                      />
                      {errors.admin?.password && (
                        <p className="text-sm text-destructive">{errors.admin.password.message}</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex justify-between">
                  <Button type="button" variant="outline" onClick={prevStep}>
                    Previous
                  </Button>
                  <Button type="button" onClick={nextStep}>
                    Next
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="3" className="space-y-4">
                <div className="space-y-4">
                  <h3 className="text-lg font-medium">Review Configuration</h3>
                  
                  <div className="space-y-2">
                    <h4 className="font-medium">Database</h4>
                    <p className="text-sm text-muted-foreground">
                      Type: MYSQL
                      <br />Host: {watch('database.host')}:{watch('database.port')}
                      <br />Database: {watch('database.database')}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-medium">Global Admin User</h4>
                    <p className="text-sm text-muted-foreground">
                      {reuseExistingDatabase && connectionProbe?.existingGlobalAdmin ? (
                        <>
                          Email: {connectionProbe.existingGlobalAdmin.email}
                          <br />Username: {connectionProbe.existingGlobalAdmin.username}
                        </>
                      ) : (
                        <>
                          Email: {watch('admin.email')}
                          <br />Username: {watch('admin.username')}
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex justify-between">
                  <Button type="button" variant="outline" onClick={prevStep}>
                    Previous
                  </Button>
                  <Button type="submit" disabled={isLoading}>
                    {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Complete Setup
                  </Button>
                </div>
              </TabsContent>
            </form>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default SetupPage;