import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { User, UpdateProfileData } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Alert, AlertDescription } from '../ui/alert';
import { User as UserIcon, Mail, Loader2 } from 'lucide-react';
import apiClient from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

const profileSchema = z.object({
  email: z.string().email('Invalid email format'),
});

type ProfileFormData = z.infer<typeof profileSchema>;

interface ProfileFormProps {
  user: User;
  onSuccess?: (updatedUser: User) => void;
}

const ProfileForm: React.FC<ProfileFormProps> = ({ user, onSuccess }) => {
  const { updateUser } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      email: user.email,
    },
  });

  const onSubmit = async (data: ProfileFormData) => {
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Only send changed fields
      const updateData: UpdateProfileData = {};
      if (data.email !== user.email) {
        updateData.email = data.email;
      }

      // If no changes, don't make API call
      if (Object.keys(updateData).length === 0) {
        setSuccess('No changes to save');
        setIsLoading(false);
        return;
      }

      const response = await apiClient.updateProfile(updateData);
      
      if (response.success && response.data?.user) {
        setSuccess('Profile updated successfully');
        updateUser(response.data.user);
        onSuccess?.(response.data.user);
        reset(data); // Reset form with new values
      } else {
        setError(response.error || 'Failed to update profile');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    reset({
      email: user.email,
    });
    setError(null);
    setSuccess(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <UserIcon className="w-5 h-5 mr-2" />
          Edit Profile
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert>
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="username" className="flex items-center">
              <UserIcon className="w-4 h-4 mr-2" />
              Username
            </Label>
            <Input
              id="username"
              value={user.username}
              disabled
              readOnly
            />
            <p className="text-xs text-muted-foreground">
              Username is set by an admin.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" className="flex items-center">
              <Mail className="w-4 h-4 mr-2" />
              Email Address
            </Label>
            <Input
              id="email"
              type="email"
              {...register('email')}
              placeholder="Enter your email address"
              disabled={isLoading}
            />
            {errors.email && (
              <p className="text-sm text-red-600">{errors.email.message}</p>
            )}
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              type="submit"
              disabled={isLoading || !isDirty}
              className="flex items-center"
            >
              {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isDirty ? 'Save Changes' : 'No New Changes'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isLoading || !isDirty}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

export default ProfileForm;