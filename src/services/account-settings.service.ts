import { httpClient } from "./http-client";

/**
 * Interfaz para AccountSettings
 */
export interface StorageProvider {
  primary?: boolean;
  distributionUrl: string;
  heavyDistributionUrl?: string;
  originUrl?: string;
  provider: string;
  hostname: string;
  cpCode?: number;
  foldersOrBuckets: string[];
}

export interface AccountSettings {
  color: string;
  title: string;
  logo: string;
  timezone: string;
  code: string;
  loginType: string;
  hasCommerce: boolean;
  cmsTextAlignRtl?: boolean;
  storageProviders?: StorageProvider[];
  migrateVodsAfterDays?: number;
  migrateVodsOrigin?: string;
  migrateVodsDestination?: string;
  migrateVodsEnabled?: boolean;
  migrateVodsAssetTypes?: string[];
  _id?: string;
  guid?: string;
  accountId?: string;
  __total?: number;
  subscriptionType?: string;
  approvalWorkflow?: boolean;
  disableNextCatchup?: boolean;
  drmEnabled?: boolean;
  hasMyList?: boolean;
  keepwatching?: boolean;
  loginHasProfiles?: boolean;
  loginHideRegister?: boolean;
  login_hide_forgotpassword?: boolean;
  login_hide_rrss?: boolean;
  mobileUseVerticalPlayer?: boolean;
  myAccountHideDeleteAccount?: boolean;
  myAccountHideMyDevices?: boolean;
  myAccountHideProfile?: boolean;
  playerSkin?: string;
  regionCache?: boolean;
  showAirDateOnPrograms?: boolean;
  smarttvPlayerMutePreview?: boolean;
  socialLogins?: Array<{
    platform: string;
    apiClientId?: string;
    clientId?: string;
  }>;
  webHasCustomNavBarDest?: boolean;
  defaultCurrency?: string;
  keepwatchingUrl?: string;
  passwordRecoveryMethod?: string;
  maxDevices?: number;
  maxProfiles?: number;
  hasNextEpisode?: boolean;
  emailProvider?: string;
  emailSender?: string;
  promotionAdsProvider?: string;
  notShowPlansAfterLogin?: boolean;
  hideSubscribeNowButton?: boolean;
  disableBannersAspectRatio?: boolean;
  hasMultimerchant?: boolean;
  mustAcceptTerms?: boolean;
  drmProviders?: any[];
  hasContentDownload?: boolean;
  webCustomNavBarDestUrl?: string;
  [key: string]: any;
}

class AccountSettingsService {
  /**
   * Obtiene los accountSettings desde la API
   * Endpoint: GET /multiscreen/account-settings?accountId=${accountId}
   * 
   * Este endpoint devuelve el objeto de accountSettings.
   * Este es el config del CMS (para todo lo que NO sea preview).
   */
  async getAccountSettings(accountId?: string): Promise<AccountSettings | null> {
    try {
      const accountIdToUse = accountId || httpClient.getAccountId();
      const bffClient = httpClient.getBffClient();
      
      // Llamar al BFF que hace passthrough a la API
      const url = `/multiscreen/account-settings?accountId=${accountIdToUse}`;
      const response = await bffClient.get<AccountSettings>(url);
      
      // El BFF devuelve directamente el objeto accountSettings
      return response.data || null;
    } catch (error) {
      console.error('Error in getAccountSettings:', error);
      const message = httpClient.getErrorMessage(error);
      throw new Error(`Error al obtener account settings: ${message}`);
    }
  }
}

export const accountSettingsService = new AccountSettingsService();

