'use strict';

var
	_ = require('underscore'),
	$ = require('jquery'),
	ko = require('knockout'),
	moment = require('moment'),

	TextUtils = require('%PathToCoreWebclientModule%/js/utils/Text.js'),
	Types = require('%PathToCoreWebclientModule%/js/utils/Types.js'),
	UrlUtils = require('%PathToCoreWebclientModule%/js/utils/Url.js'),

	App = require('%PathToCoreWebclientModule%/js/App.js'),
	Screens = require('%PathToCoreWebclientModule%/js/Screens.js'),

	CAddressListModel = require('%PathToCoreWebclientModule%/js/models/CAddressListModel.js'),
	CDateModel = require('%PathToCoreWebclientModule%/js/models/CDateModel.js'),

	MessageUtils = require('modules/%ModuleName%/js/utils/Message.js'),

	AccountList = require('modules/%ModuleName%/js/AccountList.js'),
	MailCache = null,
	MessagesDictionary = require('modules/%ModuleName%/js/MessagesDictionary.js'),
	Settings = require('modules/%ModuleName%/js/Settings.js'),

	CAttachmentModel = require('modules/%ModuleName%/js/models/CAttachmentModel.js')
;

/**
 * @constructor
 */
function CMessageModel()
{
	this.accountId = ko.observable(AccountList.currentId());
	this.accountEmail = ko.computed(function () {
		var oAccount = AccountList.getAccount(this.accountId());
		return oAccount ? oAccount.email() : '';
	}, this);
	this.showUnifiedMailboxLabel = ko.observable('');
	this.unifiedMailboxLabelText = ko.observable('');
	this.unifiedMailboxLabelColor = ko.observable('');
	ko.computed(function () {
		var oAccount = this.accountId ? AccountList.getAccount(this.accountId()) : null;
		if (oAccount)
		{
			this.showUnifiedMailboxLabel(oAccount.showUnifiedMailboxLabel());
			this.unifiedMailboxLabelText(oAccount.unifiedMailboxLabelText() || oAccount.email());
			this.unifiedMailboxLabelColor(oAccount.unifiedMailboxLabelColor());
		}
	}, this);
	this.folder = ko.observable('');
	this.uid = ko.observable('');
	this.longUid = ko.observable('');

	this.subject = ko.observable('');
	this.emptySubject = ko.computed(function () {
		return ($.trim(this.subject()) === '');
	}, this);
	this.subjectForDisplay = ko.computed(function () {
		return this.emptySubject() ? TextUtils.i18n('%MODULENAME%/LABEL_NO_SUBJECT') : this.subject();
	}, this);
	this.messageId = ko.observable('');
	this.size = ko.observable(0);
	this.friendlySize = ko.computed(function () {
		return TextUtils.getFriendlySize(this.size());
	}, this);
	this.textSize = ko.observable(0);
	this.oDateModel = new CDateModel();
	this.fullDate = ko.observable('');
	this.oFrom = new CAddressListModel();
	this.fullFrom = ko.observable('');
	this.oTo = new CAddressListModel();
	this.to = ko.observable('');
	this.fromOrToText = ko.observable('');
	this.oCc = new CAddressListModel();
	this.cc = ko.observable('');
	this.oBcc = new CAddressListModel();
	this.bcc = ko.observable('');
	this.oReplyTo = new CAddressListModel();

	this.seen = ko.observable(false);

	this.flagged = ko.observable(false);
	this.partialFlagged = ko.observable(false);
	this.answered = ko.observable(false);
	this.forwarded = ko.observable(false);
	this.hasAttachments = ko.observable(false);
	this.hasIcalAttachment = ko.observable(false);
	this.hasVcardAttachment = ko.observable(false);

	this.folderObject = ko.computed(function () {
		this.requireMailCache();
		return MailCache.getFolderByFullName(this.accountId(), this.folder());
	}, this);
	this.threadsAllowed = ko.computed(function () {
		var
			oAccount = AccountList.getAccount(this.accountId()),
			oFolder = this.folderObject(),
			bFolderWithoutThreads = oFolder && (oFolder.type() === Enums.FolderTypes.Drafts ||
				oFolder.type() === Enums.FolderTypes.Spam || oFolder.type() === Enums.FolderTypes.Trash)
		;
		return oAccount && oAccount.threadingIsAvailable() && !bFolderWithoutThreads;
	}, this);
	this.otherSendersAllowed = ko.computed(function () {
		var oFolder = this.folderObject();
		return oFolder && (oFolder.type() !== Enums.FolderTypes.Drafts) && (oFolder.type() !== Enums.FolderTypes.Sent);
	}, this);

	this.threadPart = ko.observable(false);
	this.threadPart.subscribe(function () {
		if (this.threadPart())
		{
			this.partialFlagged(false);
		}
	}, this);
	this.threadParentUid = ko.observable('');

	this.threadUids = ko.observableArray([]);
	this.threadCount = ko.computed(function () {
		return this.threadUids().length;
	}, this);
	this.threadUnreadCount = ko.observable(0);
	this.threadOpened = ko.observable(false);
	this.threadLoading = ko.observable(false);
	this.threadLoadingVisible = ko.computed(function () {
		return this.threadsAllowed() && this.threadOpened() && this.threadLoading();
	}, this);
	this.threadCountVisible = ko.computed(function () {
		return this.threadsAllowed() && this.threadCount() > 0 && !this.threadLoading();
	}, this);
	this.threadCountHint = ko.computed(function () {
		if (this.threadCount() > 0)
		{
			if (this.threadOpened())
			{
				return  TextUtils.i18n('%MODULENAME%/ACTION_FOLD_THREAD');
			}
			else
			{
				if (this.threadUnreadCount() > 0)
				{
					return  TextUtils.i18n('%MODULENAME%/ACTION_UNFOLD_THREAD_WITH_UNREAD', {}, null, this.threadUnreadCount());
				}
				else
				{
					return  TextUtils.i18n('%MODULENAME%/ACTION_UNFOLD_THREAD');
				}
			}
		}
		return '';
	}, this);
	this.threadCountForLoad = ko.observable(5);
	this.threadNextLoadingVisible = ko.observable(false);
	this.threadNextLoadingLinkVisible = ko.observable(false);
	this.threadFunctionLoadNext = null;
	this.threadShowAnimation = ko.observable(false);
	this.threadHideAnimation = ko.observable(false);

	this.importance = ko.observable(Enums.Importance.Normal);
	this.draftInfo = ko.observableArray([]);
	this.hash = ko.observable('');
	this.sDownloadAsEmlUrl = '';

	this.completelyFilled = ko.observable(false);
	this.iLastAccessTime = 0;
	this.updateLastAccessTime();

	this.checked = ko.observable(false);
	this.checked.subscribe(function (bChecked) {
		this.requireMailCache();
		if (!this.threadOpened() && MailCache.useThreadingInCurrentList())
		{
			var
				oFolder = MailCache.getFolderByFullName(this.accountId(), this.folder())
			;
			_.each(this.threadUids(), function (sUid) {
				var oMessage = MessagesDictionary.get([oFolder.iAccountId, oFolder.fullName(), sUid]);
				if (oMessage)
				{
					oMessage.checked(bChecked);
				}
			});
		}
	}, this);
	this.selected = ko.observable(false);
	this.deleted = ko.observable(false); // temporary removal until it was confirmation from the server to delete

	this.truncated = ko.observable(false);
	this.inReplyTo = ko.observable('');
	this.references = ko.observable('');
	this.readingConfirmationAddressee = ko.observable('');
	this.sensitivity = ko.observable(Enums.Sensitivity.Nothing);
	this.isPlain = ko.observable(false);
	this.text = ko.observable('');
	this.textBodyForNewWindow = ko.observable('');
	this.$text = null;
	this.rtl = ko.observable(false);
	this.hasExternals = ko.observable(false);
	this.isExternalsShown = ko.observable(false);
	this.isExternalsAlwaysShown = ko.observable(false);
	this.foundCids = ko.observableArray([]);
	this.attachments = ko.observableArray([]);
	this.safety = ko.observable(false);
	this.sourceHeaders = ko.observable('');
	this.unsubscribe = {};

	this.date = ko.observable('');

	this.textRaw = ko.observable('');

	this.domMessageForPrint = ko.observable(null);

	this.notInlineAttachments = ko.computed(function () {
		return _.filter(this.attachments(), function (oAttach) {
			return !oAttach.linked();
		});
	}, this);

	this.Custom = {};

	this.customLabels = ko.observableArray([]);
}

CMessageModel.prototype.setCustomLabel = function (sId, sText, sCssClass)
{
	if (Types.isString(sId) && Types.isNonEmptyString(sText) && Types.isString(sCssClass))
	{
		var oCustomLabel = _.find(this.customLabels(), function (oCustomLabel) {
			return oCustomLabel.id === sId;
		});
		if (oCustomLabel)
		{
			oCustomLabel.text = sText;
			oCustomLabel.cssClass = sCssClass;
		}
		else
		{
			this.customLabels.push({
				id: sId,
				text: sText,
				cssClass: sCssClass
			});
		}
	}
};

CMessageModel.prototype.removeCustomLabel = function (sId)
{
	this.customLabels(_.filter(this.customLabels(), function (oCustomLabel) {
		return oCustomLabel.id !== sId;
	}));
};

CMessageModel.prototype.requireMailCache = function ()
{
	if (MailCache === null)
	{
		MailCache = require('modules/%ModuleName%/js/Cache.js');
	}
};

/**
 * Updates last access time of the message and last access time of all messages in thread.
 */
CMessageModel.prototype.updateLastAccessTime = function ()
{
	this.iLastAccessTime = moment().unix();
	_.each(this.threadUids(), function (sUid) {
		var oMessage = MessagesDictionary.get([this.accountId(), this.folder(), sUid]);
		if (oMessage)
		{
			oMessage.updateLastAccessTime();
		}
	}, this);
};

/**
 * @param {Object} oWin
 */
CMessageModel.prototype.viewMessage = function (oWin)
{
	var
		oDomText = this.getDomText(UrlUtils.getAppPath()),
		sHtml = ''
	;

	this.textBodyForNewWindow(oDomText.html());
	sHtml = $(this.domMessageForPrint()).html();

	if (oWin)
	{
		$(oWin.document.body).html(sHtml);
		oWin.focus();
		_.each(this.attachments(), function (oAttach) {
			var oLink = $(oWin.document.body).find("[data-hash='download-" + oAttach.hash() + "']");
			if (oAttach.hasAction('download'))
			{
				oLink.on('click', _.bind(oAttach.executeAction, oAttach, 'download'));
			}
			else
			{
				oLink.hide();
			}

			oLink = $(oWin.document.body).find("[data-hash='view-" + oAttach.hash() + "']");
			if (oAttach.hasAction('view'))
			{
				oLink.on('click', _.bind(oAttach.executeAction, oAttach, 'view'));
			}
			else
			{
				oLink.hide();
			}
		}, this);
	}
};

/**
 * Fields accountId, folder, oTo & oFrom should be filled.
 */
CMessageModel.prototype.fillFromOrToText = function ()
{
	this.requireMailCache();
	var oFolder = MailCache.getFolderByFullName(this.accountId(), this.folder());

	if (oFolder && (oFolder.type() === Enums.FolderTypes.Drafts || oFolder.type() === Enums.FolderTypes.Sent))
	{
		var
			sMeRecipientReplacement = Settings.UseMeRecipientForMessages ? TextUtils.i18n('%MODULENAME%/LABEL_ME_RECIPIENT') : null,
			sToDisplay = this.oTo.getDisplay(sMeRecipientReplacement, this.accountEmail()),
			sCcDisplay = this.oCc.getDisplay(sMeRecipientReplacement, this.accountEmail()),
			sBccDisplay = this.oBcc.getDisplay(sMeRecipientReplacement, this.accountEmail()),
			aDisplay = []
		;
		if (Types.isNonEmptyString(sToDisplay)) {
			aDisplay.push(sToDisplay);
		}
		if (Types.isNonEmptyString(sCcDisplay)) {
			aDisplay.push(sCcDisplay);
		}
		if (Types.isNonEmptyString(sBccDisplay)) {
			aDisplay.push(sBccDisplay);
		}
		this.fromOrToText(aDisplay);
	}
	else
	{
		var sMeSenderReplacement = Settings.UseMeRecipientForMessages ? TextUtils.i18n('%MODULENAME%/LABEL_ME_SENDER') : null;
		this.fromOrToText(this.oFrom.getDisplay(sMeSenderReplacement, this.accountEmail()));
	}
};

/**
 * @param {Array} aChangedThreadUids
 * @param {number} iLoadedMessagesCount
 */
CMessageModel.prototype.changeThreadUids = function (aChangedThreadUids, iLoadedMessagesCount)
{
	this.threadUids(aChangedThreadUids);
	this.threadLoading(iLoadedMessagesCount < Math.min(this.threadUids().length, this.threadCountForLoad()));
};

/**
 * @param {Function} fLoadNext
 */
CMessageModel.prototype.showNextLoadingLink = function (fLoadNext)
{
	if (this.threadNextLoadingLinkVisible())
	{
		this.threadNextLoadingVisible(true);
		this.threadFunctionLoadNext = fLoadNext;
	}
};

CMessageModel.prototype.increaseThreadCountForLoad = function ()
{
	this.threadCountForLoad(this.threadCountForLoad() + 5);
	this.requireMailCache();
	MailCache.showOpenedThreads(this.folder());
};

CMessageModel.prototype.loadNextMessages = function ()
{
	if (this.threadFunctionLoadNext)
	{
		this.threadFunctionLoadNext();
		this.threadNextLoadingLinkVisible(false);
		this.threadFunctionLoadNext = null;
	}
};

/**
 * @param {number} iShowThrottle
 * @param {string} sParentUid
 */
CMessageModel.prototype.markAsThreadPart = function (iShowThrottle, sParentUid)
{
	var self = this;

	this.threadPart(true);
	this.threadParentUid(sParentUid);
	this.threadUids([]);
	this.threadNextLoadingVisible(false);
	this.threadNextLoadingLinkVisible(true);
	this.threadFunctionLoadNext = null;
	this.threadHideAnimation(false);

	setTimeout(function () {
		self.threadShowAnimation(true);
	}, iShowThrottle);
};

/**
 * @param {AjaxMessageResponse} oData
 * @param {number} iAccountId
 * @param {boolean} bThreadPart
 * @param {boolean} bTrustThreadInfo
 */
CMessageModel.prototype.parse = function (oData, iAccountId, bThreadPart, bTrustThreadInfo)
{
	var
		sHtml = '',
		sPlain = ''
	;

	if (bTrustThreadInfo)
	{
		this.threadPart(bThreadPart);
	}
	if (!this.threadPart())
	{
		this.threadParentUid('');
	}

	if (oData['@Object'] === 'Object/MessageListItem')
	{
		this.seen(!!oData.IsSeen);
		this.flagged(!!oData.IsFlagged);
		this.answered(!!oData.IsAnswered);
		this.forwarded(!!oData.IsForwarded);

		if (oData.Custom)
		{
			this.Custom = oData.Custom;
		}
	}

	if (oData['@Object'] === 'Object/Message' || oData['@Object'] === 'Object/MessageListItem')
	{
		this.Custom.Sensitivity = oData.Sensitivity;

		this.accountId(iAccountId);
		this.folder(oData.Folder);
		this.uid(Types.pString(oData.Uid));
		if (Types.isNonEmptyString(oData.UnifiedUid))
		{
			this.longUid(oData.UnifiedUid);
			var oIdentifiers = MailCache.getMessageActualIdentifiers(this.accountId(), this.folder(), this.longUid());
			this.accountId(oIdentifiers.iAccountId);
		}
		else
		{
			this.longUid(this.accountId() + ':' + this.folder() + ':' + Types.pString(oData.Uid));
		}

		this.subject(Types.pString(oData.Subject));
		this.messageId(Types.pString(oData.MessageId));
		this.size(oData.Size);
		this.textSize(oData.TextSize);
		this.oDateModel.parse(oData.TimeStampInUTC);
		this.oFrom.parse(oData.From);
		this.oTo.parse(oData.To);
		this.oCc.parse(oData.Cc);
		this.oBcc.parse(oData.Bcc);
		this.oReplyTo.parse(oData.ReplyTo);
		this.fillFromOrToText();

		this.fullDate(this.oDateModel.getFullDate());
		this.fullFrom(this.oFrom.getFull());
		this.to(this.oTo.getFull());
		this.cc(this.oCc.getFull());
		this.bcc(this.oBcc.getFull());

		this.hasAttachments(!!oData.HasAttachments);
		this.hasIcalAttachment(!!oData.HasIcalAttachment);
		this.hasVcardAttachment(!!oData.HasVcardAttachment);

		if (oData['@Object'] === 'Object/MessageListItem' && bTrustThreadInfo)
		{
			this.threadUids(_.map(oData.Threads, function (iUid) {
				return iUid.toString();
			}, this));
		}

		this.importance(Types.pInt(oData.Importance));
		if (!Enums.has('Importance', this.importance()))
		{
			this.importance(Enums.Importance.Normal);
		}
		this.sensitivity(Types.pInt(oData.Sensitivity));
		if (!Enums.has('Sensitivity', this.sensitivity()))
		{
			this.sensitivity(Enums.Sensitivity.Nothing);
		}
		if (_.isArray(oData.DraftInfo))
		{
			this.draftInfo(oData.DraftInfo);
		}
		this.hash(Types.pString(oData.Hash));
		this.sDownloadAsEmlUrl = Types.pString(oData.DownloadAsEmlUrl);

		if (oData['@Object'] === 'Object/Message')
		{
			this.truncated(oData.Truncated);
			this.inReplyTo(oData.InReplyTo);
			this.references(oData.References);
			this.readingConfirmationAddressee(Types.pString(oData.ReadingConfirmationAddressee));
			sHtml = Types.pString(oData.Html);
			sPlain = Types.pString(oData.Plain);
			if (sHtml !== '')
			{
				this.textRaw(oData.HtmlRaw);
				this.text(sHtml);
				this.isPlain(false);
			}
			else
			{
				this.textRaw(oData.PlainRaw);
				this.text(sPlain !== '' ? '<div>' + sPlain + '</div>' : '');
				this.isPlain(true);
			}
			this.$text = null;
			this.isExternalsShown(false);
			this.rtl(oData.Rtl);
			this.hasExternals(!!oData.HasExternals);
			this.foundCids(oData.FoundedCIDs);
			this.parseAttachments(oData.Attachments, iAccountId);
			this.safety(oData.Safety);
			this.sourceHeaders(oData.Headers);
			this.unsubscribe = Types.pObject(oData.Unsubscribe);

			this.aExtend = oData.Extend;
			this.completelyFilled(true);

			App.broadcastEvent('MailWebclient::ParseMessage::after', {
				msg: this
			});
		}
		else
		{
			App.broadcastEvent('MailWebclient::ParseMessageListItem::after', {
				msg: this
			});
		}

		this.updateMomentDate();
	}
};

CMessageModel.prototype.changeText = function (sNewText)
{
	this.text(sNewText);
	this.$text = null;
};

CMessageModel.prototype.updateMomentDate = function ()
{
	this.date(this.oDateModel.getShortDate(moment().clone().subtract(1, 'days').format('L') ===
		moment.unix(this.oDateModel.getTimeStampInUTC()).format('L')));
};

/**
 * @param {string=} sAppPath = ''
 * @param {boolean=} bForcedShowPictures
 *
 * return {Object}
 */
CMessageModel.prototype.getDomText = function (sAppPath, bForcedShowPictures)
{
	var $text = this.$text;

	sAppPath = sAppPath || '';

	if (this.$text === null || sAppPath !== '')
	{
		if (this.completelyFilled())
		{
			this.$text = $(this.text());

			this.showInlinePictures(sAppPath);
			if (this.safety() === true)
			{
				this.alwaysShowExternalPicturesForSender();
			}
			else if (bForcedShowPictures && this.isExternalsShown() || this.isExternalsAlwaysShown())
			{
				this.showExternalPictures();
			}

			$text = this.$text;
		}
		else
		{
			$text = $('');
		}
	}

	//returns a clone, because it uses both in the parent window and the new
	return $text.clone();
};

/**
 * @param {string=} sAppPath = ''
 * @param {boolean=} bForcedShowPictures
 *
 * return {string}
 */
CMessageModel.prototype.getConvertedHtml = function (sAppPath, bForcedShowPictures)
{
	var oDomText = this.getDomText(sAppPath, bForcedShowPictures);
	return (oDomText.length > 0) ? oDomText.wrap('<p>').parent().html() : '';
};

/**
 * Parses attachments.
 *
 * @param {object} oData
 * @param {number} iAccountId
 */
CMessageModel.prototype.parseAttachments = function (oData, iAccountId)
{
	var aCollection = oData ? oData['@Collection'] : [];

	this.attachments([]);

	if (Types.isNonEmptyArray(aCollection))
	{
		this.attachments(_.map(aCollection, function (oRawAttach) {
			var oAttachment = new CAttachmentModel(iAccountId);
			oAttachment.setMessageData(this.folder(), this.uid());
			oAttachment.parse(oRawAttach, this.folder(), this.longUid());
			return oAttachment;
		}, this));
	}
};

/**
 * Parses an array of email addresses.
 *
 * @param {Array} aData
 * @return {Array}
 */
CMessageModel.prototype.parseAddressArray = function (aData)
{
	var
		aAddresses = []
	;

	if (_.isArray(aData))
	{
		aAddresses = _.map(aData, function (oRawAddress) {
			var oAddress = new CAddressModel();
			oAddress.parse(oRawAddress);
			return oAddress;
		});
	}

	return aAddresses;
};

/**
 * Displays embedded images, which have cid on the list.
 *
 * @param {string} sAppPath
 */
CMessageModel.prototype.showInlinePictures = function (sAppPath)
{
	var aAttachments = _.map(this.attachments(), function (oAttachment) {
		return {
			CID: oAttachment.cid(),
			ContentLocation: oAttachment.contentLocation(),
			ViewLink: oAttachment.getActionUrl('view')
		};
	});

	MessageUtils.showInlinePictures(this.$text, aAttachments, this.foundCids(), sAppPath);
};

/**
 * Displays external images.
 */
CMessageModel.prototype.showExternalPictures = function ()
{
	MessageUtils.showExternalPictures(this.$text);

	this.isExternalsShown(true);
};

/**
 * Sets a flag that external images are always displayed.
 */
CMessageModel.prototype.alwaysShowExternalPicturesForSender = function ()
{
	this.isExternalsAlwaysShown(true);
	if (this.completelyFilled() && !this.isExternalsShown())
	{
		this.showExternalPictures();
	}
};

CMessageModel.prototype.openThread = function ()
{
	if (this.threadCountVisible())
	{
		var sFolder = this.folder();

		this.threadOpened(!this.threadOpened());
		this.requireMailCache();
		if (this.threadOpened())
		{
			MailCache.showOpenedThreads(sFolder);
		}
		else
		{
			MailCache.hideThreads(this);
			setTimeout(function () {
				MailCache.showOpenedThreads(sFolder);
			}, 500);
		}
	}
};

/**
 * @param {Object} oResponse
 * @param {Object} oRequest
 */
CMessageModel.prototype.onSaveAttachmentsToFilesResponse = function (oResponse, oRequest)
{
	var
		oParameters = oRequest.Parameters,
		iSavedCount = 0,
		iTotalCount = oParameters.Attachments.length
	;

	if (oResponse.Result)
	{
		_.each(oParameters.Attachments, function (sHash) {
			if (oResponse.Result[sHash] !== undefined)
			{
				iSavedCount++;
			}
		});
	}

	if (iSavedCount === 0)
	{
		Screens.showError(TextUtils.i18n('%MODULENAME%/ERROR_CANT_SAVE_ATTACHMENTS_TO_FILES'));
	}
	else if (iSavedCount < iTotalCount)
	{
		Screens.showError(TextUtils.i18n('%MODULENAME%/ERROR_SOME_ATTACHMENTS_WERE_NOT_SAVED', {
			'SAVED_COUNT': iSavedCount,
			'TOTAL_COUNT': iTotalCount
		}));
	}
	else
	{
		Screens.showReport(TextUtils.i18n('%MODULENAME%/REPORT_ATTACHMENTS_SAVED_TO_FILES'));
	}
};

CMessageModel.prototype.downloadAllAttachmentsSeparately = function ()
{
	_.each(this.attachments(), function (oAttach) {
		if (!oAttach.linked())
		{
			oAttach.executeAction('download');
		}
	});
};

/**
 * Uses for logging.
 *
 * @returns {Object}
 */
CMessageModel.prototype.toJSON = function ()
{
	return {
		uid: this.uid(),
		longUid: this.longUid(),
		accountId: this.accountId(),
		to: this.to(),
		subject: this.subject(),
		threadPart: this.threadPart(),
		threadUids: this.threadUids(),
		threadOpened: this.threadOpened()
	};
};

CMessageModel.prototype.getHeaderValue = function (sHeaderName) {
	var
		reg = new RegExp(sHeaderName + ':\s*(.+)(\n|$)', 'gm'),
		aResult = reg.exec(this.sourceHeaders())
	;
	return $.trim(Types.pString(aResult && aResult[1]));
};

module.exports = CMessageModel;
