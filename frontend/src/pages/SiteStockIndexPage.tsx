import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';

import { apiClient } from '../lib/api';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';

const SiteStockIndexPage: React.FC = () => {
  const navigate = useNavigate();
  const params = useParams();
  const siteId = Number(params.siteId);

  const [siteName, setSiteName] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const load = async () => {
      if (!Number.isFinite(siteId) || siteId <= 0) {
        setError('Invalid site');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const resp = await apiClient.getSite(siteId);
        if (!resp.success || !resp.data?.site) {
          throw new Error(resp.error || 'Failed to load site');
        }
        setSiteName(resp.data.site.name);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load site');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [siteId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pt-4 space-y-4">
        <Button variant="ghost" onClick={() => navigate(`/sites/${siteId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Site Hub
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="pt-4 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" onClick={() => navigate(`/sites/${siteId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Site Hub
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{siteName ?? 'Site'}</h1>
            <p className="text-muted-foreground">StockIndex</p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stock Index</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">This section will be expanded later.</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default SiteStockIndexPage;
