import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import SiteDetails from '../components/sites/SiteDetails';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';

const SiteCablePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const siteId = Number(params.siteId);
  const openReferenceNumber = React.useMemo(() => {
    const reference = new URLSearchParams(location.search).get('reference');
    return reference ? reference.trim() : '';
  }, [location.search]);

  if (!Number.isFinite(siteId) || siteId <= 0) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate('/sites')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Sites
        </Button>
        <Alert variant="destructive">
          <AlertDescription>Invalid site.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return <SiteDetails siteId={siteId} onBack={() => navigate(`/sites/${siteId}`)} openReferenceNumber={openReferenceNumber} />;
};

export default SiteCablePage;
