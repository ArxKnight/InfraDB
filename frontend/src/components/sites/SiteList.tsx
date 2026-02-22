import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Site } from '../../types';
import { apiClient } from '../../lib/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Alert, AlertDescription } from '../ui/alert';
import { usePermissions } from '../../hooks/usePermissions';

import { 
  Search, 
  Plus, 
  MapPin, 
  Loader2,
  Building2,
  Filter,
  SortAsc,
  SortDesc
} from 'lucide-react';

interface SiteWithLabelCount extends Site {
  label_count: number;
  sid_count?: number;
}

interface SiteListProps {
  onCreateSite: () => void;
  refreshTrigger?: number;
}

const SiteList: React.FC<SiteListProps> = ({ 
  onCreateSite, 
  refreshTrigger = 0
}) => {
  const navigate = useNavigate();
  const { canCreate } = usePermissions();
  const canCreateSites = canCreate('sites');
  const [sites, setSites] = useState<SiteWithLabelCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'created_at' | 'label_count'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [filterBy, setFilterBy] = useState<'all' | 'with_labels' | 'without_labels'>('all');

  const loadSites = async (search?: string) => {
    try {
      if (search !== undefined) {
        setSearchLoading(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const response = await apiClient.getSites({
        search: search || searchTerm,
        include_counts: true,
        limit: 50,
      });

      if (response.success && response.data) {
        let filteredSites = response.data.sites;
        
        // Apply filters
        if (filterBy === 'with_labels') {
          filteredSites = filteredSites.filter(site => site.label_count > 0);
        } else if (filterBy === 'without_labels') {
          filteredSites = filteredSites.filter(site => site.label_count === 0);
        }
        
        // Apply sorting
        filteredSites.sort((a, b) => {
          let aValue: any, bValue: any;
          
          switch (sortBy) {
            case 'name':
              aValue = a.name.toLowerCase();
              bValue = b.name.toLowerCase();
              break;
            case 'created_at':
              aValue = new Date(a.created_at);
              bValue = new Date(b.created_at);
              break;
            case 'label_count':
              aValue = a.label_count;
              bValue = b.label_count;
              break;
            default:
              aValue = a.name.toLowerCase();
              bValue = b.name.toLowerCase();
          }
          
          if (sortOrder === 'asc') {
            return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
          } else {
            return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
          }
        });
        
        setSites(filteredSites);
      } else {
        throw new Error(response.error || 'Failed to load sites');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sites');
    } finally {
      setLoading(false);
      setSearchLoading(false);
    }
  };

  useEffect(() => {
    loadSites();
  }, [refreshTrigger]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchTerm !== '') {
        loadSites(searchTerm);
      } else {
        loadSites('');
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchTerm, sortBy, sortOrder, filterBy]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading sites...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">Sites</h1>
          <p className="text-muted-foreground">
            Manage your cable labeling sites
          </p>
        </div>
        {canCreateSites && (
          <Button onClick={onCreateSite}>
            <Plus className="mr-2 h-4 w-4" />
            Create Site
          </Button>
        )}
      </div>

      {/* Search and Filters */}
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search sites by name, location, or description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
          {searchLoading && (
            <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 animate-spin" />
          )}
        </div>
        
        <div className="flex flex-wrap gap-2">
          {/* Filter Select */}
          <div className="flex items-center space-x-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select
              value={filterBy}
              onChange={(e) => setFilterBy(e.target.value as 'all' | 'with_labels' | 'without_labels')}
              className="h-9 px-3 py-1 text-sm border border-input bg-background rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">All Sites</option>
              <option value="with_labels">Sites with Labels</option>
              <option value="without_labels">Sites without Labels</option>
            </select>
          </div>

          {/* Sort Select */}
          <div className="flex items-center space-x-2">
            {sortOrder === 'asc' ? <SortAsc className="h-4 w-4 text-muted-foreground" /> : <SortDesc className="h-4 w-4 text-muted-foreground" />}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'created_at' | 'label_count')}
              className="h-9 px-3 py-1 text-sm border border-input bg-background rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="name">Sort by Name</option>
              <option value="created_at">Sort by Date Created</option>
              <option value="label_count">Sort by Label Count</option>
            </select>
          </div>

          {/* Sort Order Toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          >
            {sortOrder === 'asc' ? (
              <>
                <SortAsc className="mr-2 h-4 w-4" />
                Ascending
              </>
            ) : (
              <>
                <SortDesc className="mr-2 h-4 w-4" />
                Descending
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Sites Grid */}
      {sites.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No sites found</h3>
            <p className="text-muted-foreground text-center mb-4">
              {searchTerm 
                ? 'No sites match your search criteria. Try adjusting your search terms.'
                : (canCreateSites
                  ? 'Get started by creating your first site for cable management.'
                  : 'Get started by asking your Admin for access to a site for cable management.'
                )
              }
            </p>
            {!searchTerm && (
              canCreateSites ? (
                <Button onClick={onCreateSite}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Your First Site
                </Button>
              ) : null
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => (
            
            <Card
              key={site.id}
              className={'cursor-pointer hover:shadow-md transition-shadow'}
              onClick={() => navigate(`/sites/${site.id}`)}
            >
              <CardHeader className="pb-3 text-center">
                <CardTitle className="text-lg truncate hover:text-primary transition-colors">
                  {site.name}
                </CardTitle>
                {site.location && (
                  <CardDescription className="flex items-center justify-center mt-1">
                    <MapPin className="h-3 w-3 mr-1 flex-shrink-0" />
                    <span className="truncate">{site.location}</span>
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="pt-0 text-center">
                {site.description && (
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                    {site.description}
                  </p>
                )}
                <div className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
                  <span>{site.label_count} labels</span>
                  <span>{Number(site.sid_count ?? 0)} SID{Number(site.sid_count ?? 0) === 1 ? '' : 's'}</span>
                  <span>Created {formatDate(site.created_at)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default SiteList;