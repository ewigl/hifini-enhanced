// ==UserScript==
// @name         HIFINI 音乐磁场 增强
// @namespace    https://github.com/ewigl/hifini-enhanced
// @version      0.4.3
// @description  自动回帖，汇总网盘链接，自动填充网盘提取码。
// @author       Licht
// @license      MIT
// @homepage     https://github.com/ewigl/hifini-enhanced
// @match        http*://*.hifini.com/thread-*.htm
// @match        http*://*.lanzn.com/*
// @match        http*://*.lanzoue.com/*
// @match        http*://*.pan.quark.cn/s/*
// @icon         https://www.hifini.com/favicon.ico
// @grant        GM_addStyle
// ==/UserScript==

;(function () {
    'use strict'

    // 常量
    const constants = {
        ASIDE_CLASS: 'aside',

        QUICK_REPLY_BUTTON_ID: 'he_quick_reply_button',
        QUICK_REPLY_FORM_ID: 'quick_reply_form',
        QUICK_REPLY_INPUT_ID: 'message',
        QUICK_REPLY_SUBMIT_ID: 'submit',

        NON_REPLY_CLASS: 'alert-warning',
        REPLIED_CLASS: 'alert-success',

        DOWNLOAD_LINKS_PANEL_ID: 'he_download_links_panel',

        BAIDU_HOST: 'pan.baidu.com',
        LANZN_HOST: 'lanzn.com',
        LANZOUE_HOST: 'lanzoue.com',
        QUARK_HOST: 'pan.quark.cn',

        URL_PARAMS_PWD: 'pwd',
        LANZOU_PWD_INPUT_SELECTOR: '#pwd',
        LANZN_PWD_SUB_SELECTOR: '.passwddiv-btn',
        LANZOUE_PWD_SUB_SELECTOR: '#sub',

        USER_LOGIN_URL: '/user-login.htm',
    }

    const NET_DISK_TYPES = {
        [constants.BAIDU_HOST]: '百度',
        [constants.LANZN_HOST]: '蓝奏',
        [constants.LANZOUE_HOST]: '蓝奏',
        [constants.QUARK_HOST]: '夸克',
    }

    // 自定义样式
    const styleCSS = `
    #${constants.QUICK_REPLY_BUTTON_ID} {
        position: sticky;
        top: 16px;
    }

    #${constants.DOWNLOAD_LINKS_PANEL_ID} {
        position: sticky;
        top: 60px;
    }
    `

    // 应用自定义样式
    GM_addStyle(styleCSS)

    // 随机回复项目
    const RANDOM_REPLIES = [
        '666',
        'Good',
        'Nice',
        'Thanks',
        '给力',
        '谢谢',
        '谢谢分享',
        '谢谢大佬',
        '感谢',
        '感谢分享',
        '感谢大佬',
    ]

    // 工具
    const utils = {
        // 顺便封装一下 log 吧，加个前缀。。。
        logger(...msg) {
            const prefix = '[HIFINI Enhanced]'
            console.log(prefix, ...msg)
        },
        // 获取随机回复
        getRandomReply() {
            return RANDOM_REPLIES[Math.floor(Math.random() * RANDOM_REPLIES.length)]
        },
        // 根据页面是否有 alert-success 类元素判断当前帖是否已回复
        isReplied() {
            return $(`.${constants.REPLIED_CLASS}`).length > 0
        },
        getNetDiskTypeString(url) {
            for (let key in NET_DISK_TYPES) {
                if (url.includes(key)) {
                    return NET_DISK_TYPES[key]
                }
            }

            return '未知'
        },
        isInLanzouSite() {
            return location.host.includes(constants.LANZN_HOST) || location.host.includes(constants.LANZOUE_HOST)
        },
        isInQuarkSite() {
            return location.host.includes(constants.QUARK_HOST)
        },
        getLanzouSubButton() {
            // 确定蓝奏网盘的提交按钮，为什么蓝奏你要做两个不同的页面。(╯‵□′)╯︵┻━┻
            const subButton = $(constants.LANZN_PWD_SUB_SELECTOR)[0] || $(constants.LANZOUE_PWD_SUB_SELECTOR)[0]

            return subButton
        },
        simulateInput(element, text) {
            element.focus()
            element.value = ''
            element.setRangeText(text)
            element.dispatchEvent(new Event('input', { bubbles: true }))
            element.dispatchEvent(new Event('change', { bubbles: true }))
        },
        simulateInputWithInterval(element, text, delay = 200, clickElement) {
            element.focus()
            element.value = ''

            let index = 0
            const chars = text.split('')

            const interval = setInterval(() => {
                if (index >= chars.length) {
                    // 输入完成，触发 change 事件并清除 interval
                    const changeEvent = new Event('change', { bubbles: true, cancelable: true })
                    element.dispatchEvent(changeEvent)
                    clearInterval(interval)

                    if (clickElement) {
                        // 如果有点击元素，则模拟点击
                        clickElement.click()
                    }
                    return
                }

                // 插入单个字符
                const char = chars[index]
                element.setRangeText(char, element.selectionStart, element.selectionEnd, 'end')

                // 触发 input 事件
                const inputEvent = new Event('input', { bubbles: true, cancelable: true })
                element.dispatchEvent(inputEvent)

                index++
            }, delay)
        },
        // 提取 alert-success 中内容，包含所有链接、提取码。格式化 alert-success 中的内容。
        extractUrlOrCode(innerText) {
            // 匹配链接或（及）提取码
            const combinedRegex = /(https?:\/\/[^\s]+)|提取码:\s*([a-zA-Z0-9]+)/g

            const results = []
            let match

            while ((match = combinedRegex.exec(innerText)) !== null) {
                // 如果匹配到 URL（match[1]）
                if (match[1]) {
                    results.push({
                        type: 'url',
                        link: match[1],
                    })
                }
                if (match[2]) {
                    results.push({
                        type: constants.URL_PARAMS_PWD,
                        pwd: match[2],
                    })
                }
            }

            if (results.length === 0) {
                // 如果没有匹配到链接或"提取码"文本，则返回原始文本
                return [
                    {
                        type: constants.URL_PARAMS_PWD,
                        pwd: innerText.trim().replace('提取码', '').replace(':', '').replace('：', ''),
                    },
                ]
            }

            return results
        },
        getDrivesReady() {
            // 获取页面内所有网盘链接（百度、蓝奏、夸克）, 以及所有隐藏内容（alert-success）。
            // 逻辑基础：所有的提取码必须在隐藏内容（绿条）内。

            // 虽然叫 hiddenElements，但实际上是所有的网盘链接 + 回复可见内容。
            let hiddenElements = $(`
                a[href*="${constants.BAIDU_HOST}"],
                a[href*="${constants.LANZN_HOST}"],
                a[href*="${constants.LANZOUE_HOST}"],
                a[href*="${constants.QUARK_HOST}"],
                .${constants.REPLIED_CLASS}
                `).toArray()

            // init formattedDrives
            let formattedDrives = []

            // 遍历所有相关元素，提取其中的链接和提取码。
            hiddenElements.forEach((element) => {
                if ($(element).hasClass(constants.REPLIED_CLASS)) {
                    // alert-success 元素，格式化其中内容。
                    let parsedResult = utils.extractUrlOrCode(element.innerText)
                    parsedResult.forEach((item) => {
                        if (item.type === 'url') {
                            // 链接类型，直接 push 到 formattedDrives 中。
                            formattedDrives.push({
                                link: item.link,
                                type: utils.getNetDiskTypeString(item.link),
                                pwd: item.pwd,
                            })
                        } else if (item.type === constants.URL_PARAMS_PWD) {
                            // 提取码类型，更新 formattedDrives 中的 pwd。默认更新上一条数据。
                            formattedDrives[formattedDrives.length - 1].pwd = item.pwd
                        }
                    })
                } else {
                    // 链接类型，直接 push 到 formattedDrives 中。
                    if (formattedDrives.some((item) => item.link === element.href)) {
                        // 去重
                        return
                    } else {
                        formattedDrives.push({
                            link: element.href,
                            type: utils.getNetDiskTypeString(element.href),
                        })
                    }
                }
            })

            // 最后 map 一次，将提取码和链接拼接在一起。
            return formattedDrives.map((item) => {
                return {
                    ...item,
                    link: item.pwd ? item.link.split('?')[0] + '?pwd=' + item.pwd : item.link,
                }
            })
        },
    }

    const operation = {
        // 快速回复当前帖，模拟点击操作方式。
        quickReply() {
            const replyInputDom = $(`#${constants.QUICK_REPLY_INPUT_ID}`)
            const submitButtonDom = $(`#${constants.QUICK_REPLY_SUBMIT_ID}`)

            if (replyInputDom.length) {
                replyInputDom.focus()
                replyInputDom.val(utils.getRandomReply())

                submitButtonDom.click()

                //   或者直接提交表单？
                //   $("#quick_reply_form").submit();
            } else {
                utils.logger('需要登录。')
                window.location.href = constants.USER_LOGIN_URL
            }

            // 可选， Ajax 方式
            // 懒得做了
        },
    }

    const initAction = {
        addQuickReplyButton() {
            const quickReplyButtonDom = `<a id="${constants.QUICK_REPLY_BUTTON_ID}" class="btn btn-light btn-block mb-3"> 自动回复 </a>`
            $(`.${constants.ASIDE_CLASS}`).append(quickReplyButtonDom)

            $(document).on('click', `#${constants.QUICK_REPLY_BUTTON_ID}`, operation.quickReply)
        },
        addNetDiskLinksPanel() {
            let paneItems = utils.getDrivesReady()

            utils.logger('已提取的网盘链接: ', paneItems)

            let linksDom = ''

            paneItems.forEach((item) => {
                linksDom += `
                <a class="btn btn-light btn-block" href="${item.link}" target="_blank">
                    ${item.type} / ${item.pwd || '-'}
                </a>`
            })

            const downloadPanelDom = `
            <div id="${constants.DOWNLOAD_LINKS_PANEL_ID}" class="card">
                <div class="m-3 text-center">
                    ${linksDom}
                </div>
            </div>
            `

            $(`.${constants.ASIDE_CLASS}`).append(downloadPanelDom)
        },
        autoFillLanzouPwd() {
            const urlParams = new URLSearchParams(window.location.search)

            if (urlParams.has(constants.URL_PARAMS_PWD)) {
                let pwd = urlParams.get(constants.URL_PARAMS_PWD)

                // 秀一下模拟输入
                utils.simulateInputWithInterval($(constants.LANZOU_PWD_INPUT_SELECTOR)[0], pwd, 200, utils.getLanzouSubButton())
            }
        },
        autoFillQuarkPwd() {
            const urlParams = new URLSearchParams(window.location.search)

            if (urlParams.has(constants.URL_PARAMS_PWD)) {
                let pwd = urlParams.get(constants.URL_PARAMS_PWD)

                // 利用 observer，等待页面加载完成。
                const observer = new MutationObserver((mutations) => {
                    mutations.forEach((mutation) => {
                        utils.logger('MutationObserver 触发: ', mutation)
                        if (mutation.type === 'childList') {
                            const inputElement = document.querySelector('input[placeholder="请输入提取码，不区分大小写"]')
                            if (inputElement) {
                                // utils.simulateInput(inputElement, pwd)
                                utils.simulateInputWithInterval(inputElement, pwd)
                                utils.logger('提取码已填充: ', pwd)
                                // 停止观察
                                observer.disconnect()
                            }
                        }
                    })
                })
                const config = { childList: true, subtree: true }
                const targetNode = document.querySelector('#ice-container')
                // 开始观察
                observer.observe(targetNode, config)
            }
        },
    }

    // 程序入口
    const main = {
        init() {
            if (utils.isInLanzouSite()) {
                // 自动填充蓝奏网盘提取码
                initAction.autoFillLanzouPwd()
            } else if (utils.isInQuarkSite()) {
                // 自动填充夸克网盘提取码
                initAction.autoFillQuarkPwd()
            } else {
                // 始终添加快速回复按钮
                initAction.addQuickReplyButton()
                // 若帖子已被回复，添加网盘链接面板
                utils.isReplied() && initAction.addNetDiskLinksPanel()

                utils.logger('初始化完成。')
            }
        },
    }

    main.init()
})()
